// ============================================================
//  肉鸽小游戏 —— 第二阶段：战斗循环
//  - 每 1 秒在玩家周围随机生成红色敌人，敌人自动追向玩家
//  - 玩家每 0.5 秒自动向最近的敌人发射黄色子弹
//  - 子弹命中敌人 -> 敌人消失 + 掉落绿色经验球
//  - 玩家碰到敌人掉血，血量归零游戏结束
//  - 跟随玩家的摄像机（地图比屏幕大）
//
//  数值集中在 CONFIG，方便第三阶段接升级加成。
// ============================================================

(function () {
  'use strict';

  // ------------------------------------------------------------
  //  配置
  // ------------------------------------------------------------
  const CONFIG = {
    world: { width: 5000, height: 5000 },
    grid: 100,

    // ---- 环境掩体：不可破坏的岩石 ----
    // 地图上随机撒 30~50 块深灰色石头（矩形），玩家 / 敌人 / Boss 撞上去会被挡住，
    // 子弹打到石头直接消失 —— 所以石头既能卡视野躲远程怪，也能挡 Boss 的弹幕。
    rock: {
      min: 30,             // 最少块数
      max: 50,             // 最多块数
      sizeMin: 60,         // 最小边长（正方形基准，再随机拉成长方形）
      sizeMax: 150,        // 最大边长
      aspectMin: 0.7,      // 长宽比下限（比 size 略窄/略扁）
      aspectMax: 1.4,      // 长宽比上限
      spacing: 28,         // 石头之间至少留出的缝隙（保证人能钻过去）
      playerClear: 320,    // 出生点周围这么多距离内不生成石头（玩家不会一开局被卡住）
      edgeMargin: 40,      // 离地图边缘的空隙
      cell: 220,           // 空间网格格边长（碰撞查询用的粗筛）
      color: '#3a3f46',    // 深灰色岩石主体
      topColor: '#4a5058', // 顶部亮面（给一点体积感）
      edgeColor: '#242830',// 描边
      speckColor: '#2b2f36'// 表面碎石斑点
    },

    player: {
      size: 28,
      speed: 260,          // 像素/秒
      maxHp: 100,
      invulnTime: 0.8,     // 受伤后的无敌时间，避免被瞬间连击秒杀
      color: '#3d8bff'
    },

    // ---- 源氏核心玩法：Shift 冲刺 ----
    dash: {
      speed: 1500,         // 冲刺速度（像素/秒）
      duration: 0.15,      // 冲刺持续时间（秒）-> 冲刺距离 = speed × duration ≈ 225 像素
      cooldown: 8.0,       // 冷却 8 秒，击杀敌人立刻重置
      invuln: 0.22,        // 冲刺过程中的无敌时间（躲避手感）
      trailInterval: 0.018,// 残影生成间隔

      // 冲刺伤害：撞到敌人就砍一刀。
      // 同一个敌人在"单次冲刺"里只会被打中一次（敌人身上的 dashHit 标记），
      // 所以贴脸原地冲刺也不会连续掉血。伤害同样吃攻击力倍率（玩家攻击力增益）。
      damage: 26
    },

    // ---- 源氏核心玩法：Q 拔刀（竜神の剣を喰らえ）----
    blade: {
      energyMax: 100,      // 能量上限
      energyPerHit: 1,     // 命中敌人 +1% 能量
      energyPerKill: 5,    // 击杀敌人 +5% 能量

      radiusBase: 190,     // 半圆基础半径
      radiusPerBullet: 34, // 每颗额外子弹（多重射击 BUFF）增加的半径
      radiusMax: 620,      // 半径上限，防止糊满屏幕

      angleHalf: Math.PI / 2,  // 半圆 = 左右各 90°，共 180°
      damage: 200,             // 对半圆内敌人的大量伤害
      duration: 8.0,           // 拔刀状态持续 8 秒
      attackMul: 2,            // 攻速翻倍（射速 = 2 倍）
      speedMul: 2,             // 移速翻倍

      // 拔刀状态下鼠标左键的扇形挥砍
      //  重要：伤害范围 = bladeRadius()（同一个半圆，随子弹数量增益放大）。
      //        slash.radiusMul 只是给它一个额外倍率，默认 1 = 与屏幕上画出的半圆完全一致。
      slash: {
        angleHalf: Math.PI * 0.5,  // 左右各 90° -> 180° 扇形，与半圆绘制一致
        radiusMul: 1,              // 伤害半径倍率（1 = 严格等于 bladeRadius()）
        hitPad: 14,                // 判定宽容度：敌人自身的体积，让边缘的怪也能被砍到
        damage: 80,                // 每个命中敌人的伤害（再乘攻击力倍率）
        cooldown: 0.36,            // 冷却 0.36 秒，拔刀攻速翻倍后 -> 0.18 秒
        lifesteal: 2               // 每命中一个敌人回复的生命值（大招吸血）
      }
    },

    enemy: {
      size: 26,
      speed: 115,          // 像素/秒
      hp: 20,
      damage: 10,
      color: '#e5434a',
      spawnInterval: 1.0,  // 每 1 秒一波
      spawnCount: 1,       // 每波数量（随时间增长）
      growthEvery: 15,     // 每 15 秒每波 +1
      maxSpawnCount: 6,
      maxCount: 90,        // 场上上限，防止卡顿
      minSpawnDist: 420,   // 生成在屏幕外，不会凭空贴脸
      maxSpawnDist: 900,
      hpGrowthEvery: 20,   // 每 20 秒 +4 血
      hpGrowthAmount: 4,

      // ---- 敌人种类：三选一的抽取权重（快速 / 远程会随时间逐渐变多）----
      // 说明：size 是"碰撞方块"的边长；快速敌人更小 -> 更难被打到，
      //      因此它的半径判定同时用小尺寸精确处理，不做额外宽容。
      // 数值刻意让远程怪稀有一些（约 10%），避免屏幕被弹幕糊满。
      typeWeights: { normal: 4.5, fast: 4.5, ranged: 1 },

      // ---- 快速敌人（黄色）：小、快、脆 ----
      fast: {
        size: 17,            // 明显比普通敌人的 26 小
        speedMul: 2.0,       // 跑得飞快（基础 115 -> 230 像素/秒）
        hpMul: 0.5,          // 血更少（基础 10 血）
        damageMul: 0.7,      // 撞人也没那么疼
        color: '#ffd93d'
      },

      // ---- 远程敌人（紫色）：不追人，保持距离放冷枪 ----
      ranged: {
        size: 26,
        speedMul: 1.0,
        hpMul: 1.0,
        damageMul: 1.0,
        color: '#b46cff',

        maxAlive: 4,         // 屏幕内同时存在的紫色怪上限（防止弹幕糊屏）

        // AI：先追人 -> 进入 activeDist 停住并开火 -> 玩家跑出 resumeDist 才继续追
        // resumeDist > activeDist 是"滞回"，避免在边界上反复起步/刹车导致抖动
        activeDist: 300,     // 进入这个距离才停下开火
        resumeDist: 400,     // 玩家跑得比这个还远就继续追

        fireInterval: 2.0,   // 停下后每 2 秒一发
        fireDelay: 0.8,      // 刚出生/刚进入射程后的第一发延迟，不会一到位就开枪
        bulletSpeed: 250,    // 比玩家子弹（640）慢得多，专门留出躲闪时间
        bulletDamage: 8,
        bulletRadius: 4,     // 子弹画小一点，减少视觉干扰
        bulletRange: 1100,   // 射程也跟着缩短，屏幕上不会飘满旧子弹
        aimLead: 0.35,       // 朝"玩家当前位置 + 一点提前量"开火
        bulletColor: '#c98bff'
      }
    },

    bullet: {
      radius: 5,
      speed: 640,
      damage: 10,
      fireInterval: 0.5,
      color: '#ffd93d',
      range: 1000           // 超出射程自动消失
    },

    orb: {
      radius: 6,
      color: '#57e07a',
      speed: 145,           // 缓慢飘向玩家
      pickupDist: 26,
      expireTime: 30
    },

    // ---- Boss 战 ----
    // 触发：Boss 进度攒满，或本轮存活计时到线
    // 打赢之后普通小怪停 5 秒 -> 重新开刷，并且下一轮整体更难一点（见 boss.difficulty）
    //
    // ★ 轮回成长（raid.round = 已经打赢的轮数，从 0 开始）：
    //     第 n 轮（n = round + 1）所需击杀 = progressNeed + progressNeedStep × round
    //                                      100 → 150 → 200 → 250 ...
    //     第 n 轮的存活计时门槛 = triggerTimeBase + triggerTimeStep × round
    //                                      120s → 150s → 180s → 210s ...
    //     Boss 血量 × (1 + hpPerRound × round)      2 600 → 3 120 → 3 640（+20%/轮）
    //     Boss 伤害 × (1 + damagePerRound × round)   26 → 28.6 → 31.2（+10%/轮）
    boss: {
      triggerTimeBase: 120,    // 第一轮：存活 120 秒（2 分钟）
      triggerTimeStep: 30,     // 每多一轮 +30 秒（第二轮 2 分 30 秒）
      progressNeed: 100,       // 第一轮：击杀 100
      progressNeedStep: 50,    // 每多一轮 +50 击杀（第二轮 150，第三轮 200 ...）
      progressPerKill: 1,      // ★ 每击杀一个敌人增加的进度（想更难就调小）

      size: 168,               // 巨大的暗红色方块（约普通怪的 6.5 倍）
      color: '#a8121f',
      coreColor: '#ff3b3b',
      edgeColor: '#e8434f',

      hpBase: 2600,            // 基础血量（还要乘上轮次成长和本轮存活时间成长）
      hpPerRound: 0.20,        // ★ 每打赢一轮血量 +20%
      hpTimeFactor: 6,         // 每存活 1 秒多 6 点血
      speed: 62,               // 移动很慢：玩家正常跑速 260，轻易拉开距离
      damage: 26,              // 撞击伤害（偏高，但可以被无敌帧 / 冲刺躲过）
      damagePerRound: 0.10,    // ★ 每打赢一轮伤害 +10%（撞击与弹幕一起涨）
      contactPush: 30,
      invulnTime: 0.9,

      approachDist: 470,       // 太近就绕圈，避免和玩家糊在一起（怪也画不出来）
      orbitDist: 380,          // 绕圈半径
      orbitSpeed: 0.5,         // 绕圈角速度（弧度/秒）

      barrageInterval: 5.0,    // 每 5 秒一轮弹幕
      barrageArms: 20,         // 20 颗子弹铺满一圈
      barrageWaves: 3,         // 一轮打 3 波，波与波之间旋转一点 -> 走位有空隙
      barrageWaveDelay: 0.24,  // 波间隔（秒）
      barrageSpin: 0.21,       // 每波的旋转偏移（弧度）
      bulletSpeed: 250,        // 比玩家子弹慢得多，Shift 一步就能穿过去
      bulletDamage: 15,        // 偏高的伤害：硬吃几发就危险
      bulletRadius: 6,
      bulletRange: 1500,
      telegraph: 0.55,         // 开火前的蓄力预警时间（地上红色圆环收缩）
      muzzleGap: 16,           // 子弹从方块边缘外面生成

      contactCd: 1.6,          // 两次撞击伤害之间的最短间隔（每次都会给无敌帧）

      orbDrop: 70,             // 击败后掉落的经验球数量
      clearDelay: 5.0,         // 清场观望时间，之后重新刷新普通小怪
      announceTime: 3.0,       // "BOSS 来袭" 横幅时长

      difficulty: {            // 每一轮打赢后小怪变强一点
        hpStep: 0.14,          // 血量 +14%
        speedStep: 0.06,       // 移速 +6%
        maxMul: 4              // 上限，防止无限膨胀到打不动
      }
    }
  };

  // ------------------------------------------------------------
  //  画布 / 视口
  // ------------------------------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // 记下默认射击间隔：reset() 时用它把 player / CONFIG 一起还原
  const DEFAULT_FIRE_INTERVAL = CONFIG.bullet.fireInterval;

  // 升级面板（HTML 元素，不用 Canvas 画，点起来方便）
  const panelEl = document.getElementById('upgradePanel');
  const optionsEl = document.getElementById('upgradeOptions');
  const audioBtnEl = document.getElementById('audioBtn');

  // ------------------------------------------------------------
  //  背景音乐
  //  浏览器不允许无交互自动播放，所以第一次点击/按键时才启动。
  // ------------------------------------------------------------
  const MUSIC = {
    src: 'bgm.mp4.mp4',   // 工作区里的音频（MP4 容器 + AAC，浏览器可直接播）
    volume: 0.5,          // 默认音量：适中，不吵
    fadeIn: 0.4           // 淡入时长（秒）
  };

  const music = {
    el: null,
    silent: false,        // 静音开关状态
    started: false,       // 是否已经成功开始播放
    failed: false,        // 播放失败（格式不支持等）
    target: 0,            // 音量目标值（0=静音，MUSIC.volume=正常）
    fadingOut: false      // 正在淡出（淡到 0 才真正 pause）
  };

  function ensureAudioElement() {
    if (music.el) return music.el;
    const el = new Audio();
    el.src = MUSIC.src;
    el.loop = true;
    el.preload = 'auto';
    el.volume = MUSIC.volume;
    music.el = el;
    return el;
  }

  /** 尝试开始播放（必须在用户交互的调用栈里） */
  function startMusic() {
    if (music.started || music.silent) return;
    const el = ensureAudioElement();
    // 淡入：从 0 升到目标音量，避免一上来"砰"一声
    el.volume = 0;
    music.target = MUSIC.volume;
    music.fadingOut = false;

    const p = el.play();
    if (p && typeof p.then === 'function') {
      p.then(function () {
        music.started = true;
        music.failed = false;
      }).catch(function () {
        // 被自动播放策略拦下：保持未开始状态，等下一次交互再试
        music.target = 0;
      });
    } else {
      music.started = true;
    }
  }

  /**
   * 第一次交互时启动音乐。
   * 用 window 上的监听（冒泡阶段）：这样点升级卡牌时，
   * 卡牌自己的点击处理先跑，音乐随后启动，互不干扰。
   */
  function armMusicStart() {
    const events = ['pointerdown', 'mousedown', 'keydown', 'touchstart'];
    const onFirst = function () {
      startMusic();
      initSfx();     // 音效也要在用户交互后才能用（AudioContext 会被挂起）
      // 只有真的播起来了才拆监听；失败就留着，下次交互再试
      if (music.started || music.failed) {
        events.forEach(function (t) { window.removeEventListener(t, onFirst); });
      }
    };
    events.forEach(function (t) {
      window.addEventListener(t, onFirst, { passive: true });
    });
  }

  /** 开关静音 */
  function setMuted(muted) {
    music.silent = muted;

    if (muted) {
      // 淡出到 0 之后才真正暂停（见 updateMusic）
      music.target = 0;
      music.fadingOut = true;
    } else if (music.el && music.started) {
      // 取消静音：从当前音量淡回正常
      music.target = MUSIC.volume;
      music.fadingOut = false;
      const p = music.el.play();
      if (p && typeof p.catch === 'function') p.catch(function () {});
    } else {
      // 还没播过 -> 当作一次交互，尝试启动
      music.fadingOut = false;
      startMusic();
    }

    if (audioBtnEl) {
      if (muted) audioBtnEl.classList.add('muted');
      else audioBtnEl.classList.remove('muted');
      audioBtnEl.title = muted ? '取消静音（M）' : '静音（M）';
    }

    // 音效也一起静音 / 恢复
    updateSfxGain();
  }

  function toggleMute() {
    setMuted(!music.silent);
  }

  if (audioBtnEl) {
    audioBtnEl.addEventListener('click', function (e) {
      e.stopPropagation();   // 别让这次点击被当成"首次交互启动音乐"
      toggleMute();
    });
  }

  // ------------------------------------------------------------
  //  游戏音效
  //  用 Web Audio API：先把文件解码成 buffer，触发时零延迟播放，
  //  这样才做得到"80ms 内只响一次"这种干净的音效节流。
  // ------------------------------------------------------------
  // 说明：
  //   冲刺音效 = 代码实时合成（见 playDashWhoosh），**不使用任何音频文件**，
  //              所以这里没有 dash 这一项，也永远不会误用 kill.mp3。
  //              以后有正式的 dash.mp3 时：加一行 dash: 'dash.mp3'，
  //              并把 startDash 里的 playDashWhoosh() 换成 playSfx('dash') 即可。
  //   大招音效 = 暂时仍复用工作区里唯一的技能音频 kill.mp3.mp3（降速+加大音量）。
  const SFX_FILES = {
    shoot: 'shoot.mp3.wav',
    hit: 'hit.mp3.wav',
    kill: 'kill.mp3.mp3',
    ultimate: 'kill.mp3.mp3',    // ← 有 ultimate.mp3 就改成 'ultimate.mp3'
    exp: 'exp.ogg.ogg',
    levelup: 'levelup.ogg.ogg'
  };

  // 每个音效的音量与节流间隔（毫秒）
  const SFX_CONF = {
    shoot: { volume: 0.15, minGap: 0 },      // 非常小声
    hit: { volume: 0.15, minGap: 80 },       // 关键：怪多时不会叠成噪音
    kill: { volume: 0.15, minGap: 0 },
    // 冲刺：不在这里，它是 Web Audio 实时合成的"嗖"（见 playDashWhoosh）
    // 和 kill 用同一个音频文件，但音量更大、单独节流，并降速播放（rate 0.8）听感更厚重：
    // 开大招的瞬间必须听得见，也不受小怪死亡音效的节流影响
    ultimate: { volume: 0.60, minGap: 300, rate: 0.8 },
    exp: { volume: 0.30, minGap: 0 },
    levelup: { volume: 0.40, minGap: 0 }
  };

  const SFX_FALLBACK_VOICES = 3;   // 没有 Web Audio 时，每个音效轮换几个 <audio>

  const sfx = {
    ctx: null,
    master: null,       // 总音量（静音按钮控制它）
    buffers: {},        // name -> AudioBuffer
    ready: false,       // 是否已经解码完
    loading: false,
    usingFallback: false,
    fallbackVoices: {}, // name -> [HTMLAudioElement]
    lastPlay: {}        // name -> 上次播放时间（ms）
  };

  function createAudioContext() {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try {
      return new Ctor();
    } catch (e) {
      return null;
    }
  }

  /** 准备一套 <audio> 备用音源（浏览器不支持 Web Audio 时用） */
  function buildFallbackVoices() {
    sfx.usingFallback = true;
    for (const name in SFX_CONF) {
      const voices = [];
      for (let i = 0; i < SFX_FALLBACK_VOICES; i++) {
        const el = new Audio();
        el.src = SFX_FILES[name];
        el.preload = 'auto';
        el.volume = SFX_CONF[name].volume;
        voices.push(el);
      }
      sfx.fallbackVoices[name] = voices;
    }
    sfx.ready = true;
  }

  /** 初始化音效（必须在用户交互的调用栈里） */
  function initSfx() {
    if (sfx.ready || sfx.loading) {
      // 已经建好但被挂起（比如切到后台过），恢复一下
      if (sfx.ctx && sfx.ctx.state === 'suspended' && sfx.ctx.resume) sfx.ctx.resume();
      return;
    }
    sfx.loading = true;

    const ctx = createAudioContext();
    if (!ctx) {
      // 不支持 Web Audio -> 退回 <audio>
      buildFallbackVoices();
      sfx.loading = false;
      return;
    }

    sfx.ctx = ctx;
    // 所有音效都经过 master，静音按钮只需要把 master 拉到 0
    const master = ctx.createGain();
    master.gain.value = music.silent ? 0 : 1;
    if (master.connect) master.connect(ctx.destination);
    sfx.master = master;

    const names = Object.keys(SFX_FILES);
    let pending = names.length;
    let failed = 0;

    names.forEach(function (name) {
      const url = SFX_FILES[name];

      function giveUp() {
        failed++;
        if (failed === names.length) {
          // 一个都没解码成功 -> 退回 <audio>，保证还有声音
          sfx.ctx = null;
          sfx.master = null;
          buildFallbackVoices();
        }
      }

      function done() {
        pending--;
        if (pending === 0) {
          sfx.loading = false;
          if (failed < names.length) sfx.ready = true;
        }
      }

      // 整条链都包在 try 里：decodeAudioData 有可能同步抛错，
      // 同步抛错会直接把 then 链掐断（既不 catch 也不 finally），
      // 那样音效就会静悄悄地全失效。
      try {
        fetch(url)
          .then(function (res) {
            if (!res || res.ok === false) throw new Error('HTTP ' + (res && res.status));
            return res.arrayBuffer();
          })
          .then(function (buf) {
            return ctx.decodeAudioData(buf);
          })
          .then(function (decoded) {
            sfx.buffers[name] = decoded;
          })
          .catch(giveUp)
          .then(done);
      } catch (e) {
        giveUp();
        done();
      }
    });
  }

  function nowMs() {
    return (typeof performance !== 'undefined' && performance.now)
      ? performance.now()
      : Date.now();
  }

  /** 播放一个音效；name 见 SFX_CONF。rate < 1 更低沉，rate > 1 更清脆 */
  function playSfx(name, rate) {
    const conf = SFX_CONF[name];
    if (!conf) return false;

    // 静音时直接不发声（物理上不会响，也就没必要解码/调度）
    if (music.silent) return false;

    const t = nowMs();
    if (conf.minGap > 0) {
      const last = sfx.lastPlay[name];
      if (last !== undefined && t - last < conf.minGap) return false;   // 节流
    }

    // 播放速度：优先用调用方给的（音高微随机），否则用配置里的
    let useRate = (rate === undefined) ? (conf.rate === undefined ? 1 : conf.rate) : rate;
    if (!(useRate > 0)) useRate = 1;

    if (sfx.usingFallback) {
      const voices = sfx.fallbackVoices[name];
      if (!voices || !voices.length) return false;
      // 找一个空闲的，或者轮换使用
      let chosen = null;
      for (let i = 0; i < voices.length; i++) {
        if (voices[i].paused) { chosen = voices[i]; break; }
      }
      if (!chosen) chosen = voices[(sfx.lastPlay[name + '#i'] = ((sfx.lastPlay[name + '#i'] || 0) + 1)) % voices.length];
      try {
        chosen.currentTime = 0;
        if ('playbackRate' in chosen) {
          try { chosen.playbackRate = useRate; } catch (e2) {}
        }
        const p = chosen.play();
        if (p && typeof p.catch === 'function') p.catch(function () {});
      } catch (e) {
        return false;
      }
      sfx.lastPlay[name] = t;
      return true;
    }

    if (!sfx.ready || !sfx.buffers || !sfx.buffers[name]) return false;

    const ctx = sfx.ctx;
    const src = ctx.createBufferSource();
    src.buffer = sfx.buffers[name];
    src.__name = name;   // 便于调试/测试识别是哪个音效
    // 同一个音频文件靠播放速度区分音色（冲刺更尖、大招更沉）
    if (src.playbackRate && src.playbackRate.setValueAtTime) {
      src.playbackRate.setValueAtTime(useRate, ctx.currentTime || 0);
    } else if (src.playbackRate) {
      src.playbackRate.value = useRate;
    }

    const gain = ctx.createGain();
    gain.gain.value = conf.volume;
    src.connect(gain);
    if (gain.connect && sfx.master) gain.connect(sfx.master);

    // 每次播放用独立节点 -> 同一个音效可以重叠播放
    if (src.start) src.start(0);

    sfx.lastPlay[name] = t;
    return true;
  }

  // ------------------------------------------------------------
  //  冲刺音效：代码实时合成的"嗖"（破空声）
  //  不读取任何音频文件，因此绝不会再误用 kill.mp3。
  //  做法：一段白噪声 + 带通滤波器（800Hz -> 3800Hz 的扫频）+ 快起慢落的音量包络。
  //  没有 Web Audio 时直接静音（宁可不响，也不拿击杀音效凑数）。
  // ------------------------------------------------------------
  const DASH_SFX = {
    volume: 0.5,        // 峰值音量（再乘总音量 masterGain）
    dur: 0.26,          // 持续时长（秒）
    noiseDur: 0.4,      // 噪声底料长度（秒）
    startHz: 800,       // 滤波器起始频率
    endHz: 4400,        // 扫到的最高频率
    q: 1.2,
    minGap: 90          // 极短节流：连续冲刺时不会叠成噪音
  };

  function makeNoiseBuffer(ctx, seconds) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** 播一声合成的"嗖"；返回是否真的发声 */
  function playDashWhoosh() {
    if (music.silent) return false;
    if (sfx.usingFallback) return false;          // 没有 Web Audio -> 静音，不凑数
    const ctx = sfx.ctx;
    if (!ctx || !sfx.ready || !sfx.master) return false;

    const t = nowMs();
    const last = sfx.lastPlay.dashSynth;
    if (last !== undefined && t - last < DASH_SFX.minGap) return false;
    sfx.lastPlay.dashSynth = t;

    try {
      const now = ctx.currentTime || 0;
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();

      const src = ctx.createBufferSource();
      src.buffer = makeNoiseBuffer(ctx, DASH_SFX.noiseDur);

      // 带通扫频：低 -> 高，制造"唰"地划过去的听感
      let node = src;
      if (ctx.createBiquadFilter) {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.value = DASH_SFX.q;
        bp.frequency.setValueAtTime(DASH_SFX.startHz, now);
        bp.frequency.exponentialRampToValueAtTime(DASH_SFX.endHz, now + DASH_SFX.dur);
        src.connect(bp);
        node = bp;
      }

      // 音量包络：4ms 起音 + 指数收尾 = 干脆的"嗖"
      const gain = ctx.createGain();
      const peak = DASH_SFX.volume * rand(0.85, 1.15);   // 轻微随机，连冲不呆板
      const dur = DASH_SFX.dur;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(peak, now + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      node.connect(gain);
      if (!sfx.master) return false;     // 没有总线就别放声，避免绕过静音控制
      gain.connect(sfx.master);

      src.start(now);
      src.stop(now + dur + 0.02);
      sfx.synthPlays = (sfx.synthPlays || 0) + 1;
      return true;
    } catch (e) {
      return false;    // 合成失败也不能影响冲刺本身
    }
  }

  /** 静音按钮同时作用于音效总音量 */
  function updateSfxGain() {
    if (!sfx.master) return;
    const ctx = sfx.ctx;
    const target = music.silent ? 0 : 1;
    const t = ctx && ctx.currentTime ? ctx.currentTime : 0;
    const g = sfx.master.gain;
    if (g.cancelScheduledValues) g.cancelScheduledValues(t);
    if (g.setValueAtTime) g.setValueAtTime(g.value === undefined ? target : g.value, t);
    if (g.linearRampToValueAtTime) g.linearRampToValueAtTime(target, t + 0.08);
    else g.value = target;
  }

  let viewWidth = 0;
  let viewHeight = 0;

  function resize() {
    viewWidth = window.innerWidth;
    viewHeight = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewWidth * dpr);
    canvas.height = Math.floor(viewHeight * dpr);
    canvas.style.width = viewWidth + 'px';
    canvas.style.height = viewHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }

  window.addEventListener('resize', resize);

  // ------------------------------------------------------------
  //  输入
  // ------------------------------------------------------------
  const keys = Object.create(null);

  window.addEventListener('keydown', function (e) {
    keys[e.code] = true;
    if (
      e.code === 'ArrowUp' || e.code === 'ArrowDown' ||
      e.code === 'ArrowLeft' || e.code === 'ArrowRight' ||
      e.code === 'Space'
    ) {
      e.preventDefault();
    }
  });

  window.addEventListener('keyup', function (e) {
    keys[e.code] = false;
  });

  // 失焦清空按键，避免"卡键"
  window.addEventListener('blur', function () {
    for (const k in keys) keys[k] = false;
  });

  // ------------------------------------------------------------
  //  游戏状态
  // ------------------------------------------------------------
  const game = {
    time: 0,          // 存活时间（秒）
    kills: 0,
    over: false,
    paused: false,    // 手动暂停中
    choosing: false,  // 升级选择面板打开中（同样冻结游戏）
    shake: 0,         // 受伤时屏幕震动剩余时间
    level: 1,
    xp: 0,            // 当前等级已获得的经验
    xpNeed: 5,        // 升到下一级所需经验

    // ---- 源氏核心玩法 ----
    energy: 0,        // 大招能量（0 ~ CONFIG.blade.energyMax）
    ultimates: 0      // 本局释放大招次数
  };

  const player = {
    x: 0, y: 0,
    size: CONFIG.player.size,
    speed: CONFIG.player.speed,
    hp: CONFIG.player.maxHp,
    maxHp: CONFIG.player.maxHp,
    invuln: 0,        // 无敌剩余时间
    flash: 0,         // 受击闪白剩余时间
    facing: { x: 1, y: 0 },

    // ---- 受升级影响的数值 ----
    attackMul: 1,          // 攻击力倍率
    attackFlat: 0,         // 攻击力固定加成
    fireInterval: CONFIG.bullet.fireInterval,
    projectiles: 1,        // 每次开火的子弹数（多重射击 BUFF：Q 半圆半径随它放大）
    xpMul: 1,              // 经验获取倍率
    pickupDist: CONFIG.orb.pickupDist,
    attractSpeed: CONFIG.orb.speed,

    // ---- 源氏：冲刺 ----
    dashTime: 0,           // 冲刺剩余时间
    dashCd: 0,             // 冲刺冷却剩余时间
    dashDx: 1,             // 冲刺方向（单位向量）
    dashDy: 0,

    // ---- 源氏：拔刀状态 ----
    blade: 0,              // 拔刀状态剩余时间（>0 时攻速/移速翻倍）
    slashCd: 0,            // 拔刀挥砍（鼠标左键）冷却剩余时间
    healFlash: 0           // 吸血时的绿色闪光剩余时间
  };

  const camera = { x: 0, y: 0 };

  // 鼠标位置（屏幕坐标，像素）：Shift 冲刺和 Q 拔刀都朝这里
  const aim = { x: 0, y: 0, has: false };

  function updateAimFromEvent(e) {
    if (!e) return;
    const hasClient = typeof e.clientX === 'number' && typeof e.clientY === 'number';
    if (hasClient) {
      const rect = canvas.getBoundingClientRect();
      aim.x = e.clientX - rect.left;
      aim.y = e.clientY - rect.top;
      aim.has = true;
      return;
    }
    if (typeof e.offsetX === 'number' && typeof e.offsetY === 'number') {
      aim.x = e.offsetX;
      aim.y = e.offsetY;
      aim.has = true;
      return;
    }
    // 合成测试事件：只有画布尺寸和 canvasX/canvasY，直接当作画布坐标用
    if (typeof e.canvasX === 'number' && typeof e.canvasY === 'number') {
      aim.x = e.canvasX;
      aim.y = e.canvasY;
      aim.has = true;
    }
  }

  window.addEventListener('mousemove', updateAimFromEvent);
  canvas.addEventListener('mousemove', updateAimFromEvent);

  const enemies = [];
  const bullets = [];
  const orbs = [];
  const particles = [];   // 纯特效
  const afterimages = []; // 冲刺残影（纯特效）
  const shockRings = [];  // Boss 弹幕的预警/冲击圆环（纯特效）

  // ---- Boss 与"阶段"状态 ----
  // boss 为 null 表示场上没有 Boss；raid.phase 决定现在是普通刷怪还是 Boss 战
  let boss = null;
  const raid = {
    phase: 'idle',      // idle 普通刷怪 | boss Boss 战 | clear 击败后的清场观望
    round: 0,           // 已经打赢的 Boss 轮数（0 = 还没打过）
    progress: 0,        // ★ Boss 进度：每击杀一个敌人 +1，攒满本轮门槛触发 Boss 战
                        //   击败 Boss 后归零，重新累计（不重置玩家的总击杀数 game.kills）
                        //   本轮门槛 = bossProgressNeed()，随轮次递增（100 → 150 → 200 ...）
    fightTime: 0,       // ★ 本轮"存活计时"：只在正常刷怪时累积，到本轮门槛就触发 Boss
                        //   （第 1 轮 120 秒，之后每轮 +30 秒，见 bossTriggerTime()）
                        //   Boss 生成后暂停累计，击败后归零重新计时
    clearTimer: 0,      // clear 阶段剩余时间
    banner: '',         // 屏幕中央的横幅文字（短暂停留）
    bannerTimer: 0,
    totalBossKills: 0
  };

  let spawnTimer = 0;
  let fireTimer = 0;
  let trailTimer = 0;

  // ------------------------------------------------------------
  //  工具
  // ------------------------------------------------------------
  const rand = (min, max) => min + Math.random() * (max - min);

  function dist2(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
  }

  // ------------------------------------------------------------
  //  环境掩体：岩石（静态障碍物，不可破坏）
  //  - 玩家 / 敌人 / Boss：碰到会被"挤出来"，且按 X / Y 分轴推进，
  //    所以斜着撞墙会自然地沿着墙面滑动，不会被吸住或穿过去。
  //  - 子弹：用"上一帧位置 -> 这一帧位置"的线段和石头求交，弹速再快也不会穿模。
  //  - 石块数量不多（30~50），但还是用一个空间网格做粗筛，
  //    这样敌人 / 子弹多了以后碰撞检测依旧是 O(1) 级别。
  // ------------------------------------------------------------

  const rocks = [];                                   // 所有岩石（静态，开局生成一次）
  let rockGrid = Object.create(null);                  // 网格 key -> 岩石索引数组
  const ROCK_CELL = Math.max(40, CONFIG.rock.cell);    // 空间网格格边长

  function rockCellKey(cx, cy) {
    return cx + ',' + cy;
  }

  /**
   * 只返回和"圆心 + 半径"所在范围可能相交的岩石索引。
   * rockGrid 为空（还没生成石头 / 测试环境）时返回 null，
   * 调用方直接当作"这一片没有石头"处理。
   */
  function rockIndicesNear(x, y, radius) {
    if (!rocks.length) return null;
    const cell = ROCK_CELL;
    const minCx = Math.floor((x - radius) / cell);
    const maxCx = Math.floor((x + radius) / cell);
    const minCy = Math.floor((y - radius) / cell);
    const maxCy = Math.floor((y + radius) / cell);
    const out = [];
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const list = rockGrid[rockCellKey(cx, cy)];
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          if (out.indexOf(list[i]) === -1) out.push(list[i]);
        }
      }
    }
    return out;
  }

  /** 重建岩石空间网格（生成 / 改动岩石后调用一次） */
  function rebuildRockGrid() {
    rockGrid = Object.create(null);
    for (let i = 0; i < rocks.length; i++) {
      const rk = rocks[i];
      const minCx = Math.floor((rk.x - rk.hw) / ROCK_CELL);
      const maxCx = Math.floor((rk.x + rk.hw) / ROCK_CELL);
      const minCy = Math.floor((rk.y - rk.hh) / ROCK_CELL);
      const maxCy = Math.floor((rk.y + rk.hh) / ROCK_CELL);
      for (let cx = minCx; cx <= maxCx; cx++) {
        for (let cy = minCy; cy <= maxCy; cy++) {
          const key = rockCellKey(cx, cy);
          if (!rockGrid[key]) rockGrid[key] = [];
          rockGrid[key].push(i);
        }
      }
    }
  }

  /**
   * 开局生成 30~50 块随机大小的深灰色岩石。
   * 保证：不和出生点重叠（否则玩家一开局就被卡在石头里）、不贴着地图边、
   *       石头之间留着能走人的缝隙（spacing）。
   */
  function initializeRocks() {
    rocks.length = 0;
    rockGrid = Object.create(null);

    const cfg = CONFIG.rock;
    const target = Math.floor(rand(cfg.min, cfg.max + 1));   // 30 ~ 50
    const spawnX = CONFIG.world.width / 2;
    const spawnY = CONFIG.world.height / 2;
    const clearR2 = cfg.playerClear * cfg.playerClear;
    const margin = cfg.edgeMargin;

    // 放不进去就放弃这一块（尝试次数远大于目标数量，正常情况都能放满）
    const maxAttempts = target * 90;

    for (let attempt = 0; attempt < maxAttempts && rocks.length < target; attempt++) {
      const w = rand(cfg.sizeMin, cfg.sizeMax);
      const h = w * rand(cfg.aspectMin, cfg.aspectMax);
      const hw = w / 2;
      const hh = h / 2;
      if (hw * 2 > CONFIG.world.width - margin * 2) continue;
      if (hh * 2 > CONFIG.world.height - margin * 2) continue;

      const x = rand(margin + hw, CONFIG.world.width - margin - hw);
      const y = rand(margin + hh, CONFIG.world.height - margin - hh);

      // 1) 别堵住出生点
      if (dist2(x, y, spawnX, spawnY) < clearR2) continue;

      // 2) 别和已有的石头挤在一起（留出 spacing 的缝，人能钻、子弹能穿）
      let overlap = false;
      for (let i = 0; i < rocks.length; i++) {
        const o = rocks[i];
        if (Math.abs(x - o.x) < (hw + o.hw + cfg.spacing) &&
            Math.abs(y - o.y) < (hh + o.hh + cfg.spacing)) {
          overlap = true;
          break;
        }
      }
      if (overlap) continue;

      rocks.push({
        x: x, y: y,
        hw: hw, hh: hh,
        // 给绘制用的确定性随机数（每块石头长相固定，不会逐帧闪烁）
        seed: Math.random() * 1000
      });
    }

    rebuildRockGrid();
    return rocks.length;
  }

  /** 圆形是否和某块岩石重叠（radius 传实际的碰撞半径） */
  function circleHitsRock(x, y, radius, rk) {
    const nx = Math.max(rk.x - rk.hw, Math.min(x, rk.x + rk.hw));
    const ny = Math.max(rk.y - rk.hh, Math.min(y, rk.y + rk.hh));
    return dist2(x, y, nx, ny) < radius * radius;
  }

  /** 圆形是否和场上任何岩石重叠 */
  function circleHitsAnyRock(x, y, radius) {
    const idx = rockIndicesNear(x, y, radius);
    if (!idx) return false;
    for (let i = 0; i < idx.length; i++) {
      if (circleHitsRock(x, y, radius, rocks[idx[i]])) return true;
    }
    return false;
  }

  /** 轴对齐方块（中心 x,y，边长 size）是否和任何岩石重叠 */
  function rectHitsAnyRock(x, y, size) {
    const half = size / 2;
    const idx = rockIndicesNear(x, y, half + half * 0.5);
    if (!idx) return false;
    for (let i = 0; i < idx.length; i++) {
      const rk = rocks[idx[i]];
      if (Math.abs(x - rk.x) < half + rk.hw && Math.abs(y - rk.y) < half + rk.hh) {
        return true;
      }
    }
    return false;
  }

  /**
   * 把一个圆推出所有重叠的岩石（分轴挑最短的方向推，推完就是"贴着墙"）。
   * 返回是否真的被推过。
   */
  function pushCircleOutOfRocks(o, radius) {
    const idx = rockIndicesNear(o.x, o.y, radius);
    if (!idx) return false;
    let pushed = false;

    for (let i = 0; i < idx.length; i++) {
      const rk = rocks[idx[i]];

      // 圆心到矩形内部最近点的偏移（圆心在矩形外时这就是推出去的向量）
      const nx = Math.max(rk.x - rk.hw, Math.min(o.x, rk.x + rk.hw));
      const ny = Math.max(rk.y - rk.hh, Math.min(o.y, rk.y + rk.hh));
      let dx = o.x - nx;
      let dy = o.y - ny;
      const d2 = dx * dx + dy * dy;

      if (d2 > 0.0001) {
        // 圆心在矩形外：沿最近点方向推到刚好相切
        if (d2 >= radius * radius) continue;
        const d = Math.sqrt(d2);
        const push = radius - d;
        o.x += (dx / d) * push;
        o.y += (dy / d) * push;
      } else {
        // 圆心陷在矩形内部：往最近的那条边推出去（比较四个方向的距离）
        const toLeft = o.x - (rk.x - rk.hw);
        const toRight = (rk.x + rk.hw) - o.x;
        const toTop = o.y - (rk.y - rk.hh);
        const toBottom = (rk.y + rk.hh) - o.y;
        let min = toLeft;
        let axis = 'x';
        let sign = -1;
        if (toRight < min) { min = toRight; axis = 'x'; sign = 1; }
        if (toTop < min) { min = toTop; axis = 'y'; sign = -1; }
        if (toBottom < min) { min = toBottom; axis = 'y'; sign = 1; }
        if (axis === 'x') o.x = rk.x + sign * (rk.hw + radius);
        else o.y = rk.y + sign * (rk.hh + radius);
      }
      pushed = true;
    }
    return pushed;
  }

  /**
   * 线段（子弹上一帧 -> 这一帧）是否穿过某块岩石。
   * 用 slab 法做射线与矩形求交（子弹按半径把矩形外扩），
   * 命中后把交点写进 outX/outY 里。
   */
  function segmentHitsRock(x0, y0, x1, y1, rk, radius, out) {
    const minX = rk.x - rk.hw - radius;
    const maxX = rk.x + rk.hw + radius;
    const minY = rk.y - rk.hh - radius;
    const maxY = rk.y + rk.hh + radius;

    // 起点已经在石头上（比如贴着石头开枪）
    if (x0 >= minX && x0 <= maxX && y0 >= minY && y0 <= maxY) {
      if (out) { out.x = x0; out.y = y0; }
      return true;
    }

    const dx = x1 - x0;
    const dy = y1 - y0;
    let tEnter = 0;
    let tExit = 1;

    if (Math.abs(dx) < 1e-9) {
      if (x0 < minX || x0 > maxX) return false;
    } else {
      let t1 = (minX - x0) / dx;
      let t2 = (maxX - x0) / dx;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tEnter) tEnter = t1;
      if (t2 < tExit) tExit = t2;
      if (tEnter > tExit) return false;
    }

    if (Math.abs(dy) < 1e-9) {
      if (y0 < minY || y0 > maxY) return false;
    } else {
      let t1 = (minY - y0) / dy;
      let t2 = (maxY - y0) / dy;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tEnter) tEnter = t1;
      if (t2 < tExit) tExit = t2;
      if (tEnter > tExit) return false;
    }

    if (tExit < 0 || tEnter > 1) return false;
    if (out) {
      out.x = x0 + dx * tEnter;
      out.y = y0 + dy * tEnter;
    }
    return true;
  }

  /** 子弹路径是否被岩石挡住；返回 { x, y } 命中点，或 null */
  function bulletRockHit(x0, y0, x1, y1, radius) {
    const idx = rockIndicesNear(x0, y0, Math.hypot(x1 - x0, y1 - y0) + radius + 40);
    if (!idx) return null;
    const out = { x: 0, y: 0 };
    for (let i = 0; i < idx.length; i++) {
      if (segmentHitsRock(x0, y0, x1, y1, rocks[idx[i]], radius, out)) {
        return { x: out.x, y: out.y };
      }
    }
    return null;
  }

  /** 岩石挡住了"从 ax,ay 到 bx,by"的直线吗（远程怪卡视野用） */
  function rockBlocksLine(ax, ay, bx, by, pad) {
    if (!rocks.length) return false;
    const r = pad === undefined ? 0 : pad;
    const idx = rockIndicesNear(ax, ay, Math.hypot(bx - ax, by - ay) + r + 40);
    if (!idx) return false;
    for (let i = 0; i < idx.length; i++) {
      if (segmentHitsRock(ax, ay, bx, by, rocks[idx[i]], r, null)) return true;
    }
    return false;
  }

  /** 玩家 / 敌人的统一收尾：先被岩石挤出来，再夹进地图边界内 */
  function settleActor(o, radius) {
    pushCircleOutOfRocks(o, radius);
    o.x = Math.max(radius, Math.min(CONFIG.world.width - radius, o.x));
    o.y = Math.max(radius, Math.min(CONFIG.world.height - radius, o.y));
    return o;
  }

  // ------------------------------------------------------------
  //  Boss 战：数值成长
  //  raid.round = 已经打赢的轮数（0 = 第一轮还没打），所以"当前是第 round+1 轮"：
  //    所需击杀  = progressNeed    + progressNeedStep × round   100 → 150 → 200
  //    计时门槛  = triggerTimeBase + triggerTimeStep  × round   120 → 150 → 180 秒
  //    Boss 血量 = 基础 × (1 + hpPerRound     × round)          +20% / 轮
  //    Boss 伤害 = 基础 × (1 + damagePerRound × round)          +10% / 轮
  //  小怪强度见 raidHpMul / raidSpeedMul（只影响**新刷出来**的小怪，
  //  场上已有的怪不会被凭空加强）
  // ------------------------------------------------------------

  /** ★ 本轮触发 Boss 所需的击杀数（第 1 轮 100，第 2 轮 150，第 3 轮 200 ...） */
  function bossProgressNeed() {
    const cfg = CONFIG.boss;
    return cfg.progressNeed + cfg.progressNeedStep * raid.round;
  }

  /** ★ 本轮"存活计时"触发 Boss 的门槛（第 1 轮 120 秒，第 2 轮 150 秒 ...） */
  function bossTriggerTime() {
    const cfg = CONFIG.boss;
    return cfg.triggerTimeBase + cfg.triggerTimeStep * raid.round;
  }

  /** ★ Boss 伤害倍率：每打赢一轮 +10%（撞击与弹幕共用） */
  function bossDamageMul() {
    return 1 + raid.round * CONFIG.boss.damagePerRound;
  }

  function raidSpeedMul() {
    const d = CONFIG.boss.difficulty;
    return Math.min(d.maxMul, 1 + raid.round * d.speedStep);
  }

  function raidHpMul() {
    const d = CONFIG.boss.difficulty;
    return Math.min(d.maxMul, 1 + raid.round * d.hpStep);
  }

  /**
   * Boss 血量：基础值 × 轮次成长（+20%/轮）+ 本轮存活时间成长。
   * 时间部分用 raid.fightTime（本轮计时，Boss 战后归零）而不是总存活 game.time，
   * 这样"磨得越久 Boss 越硬"是按本轮算的，不会因为总时长无限膨胀。
   */
  function bossMaxHp() {
    const cfg = CONFIG.boss;
    return Math.round(
      (cfg.hpBase + raid.fightTime * cfg.hpTimeFactor) * (1 + raid.round * cfg.hpPerRound)
    );
  }

  /** 圆形与轴对齐方块碰撞（方块边长 size，中心在 bx,by） */
  function circleRectHit(cx, cy, radius, bx, by, size) {
    const half = size / 2;
    const nearestX = Math.max(bx - half, Math.min(cx, bx + half));
    const nearestY = Math.max(by - half, Math.min(cy, by + half));
    return dist2(cx, cy, nearestX, nearestY) <= radius * radius;
  }

  /**
   * 统一创建粒子，并把缺省字段补齐。
   * 额外支持三种"更好看的"粒子，用于冲刺和挥砍：
   *   trail   : 身后拉出的短线拖尾（length / width 为长度和粗细）
   *   streak  : 沿角度一次性拉出的刀光碎片（渐隐但不收缩，画出流星感）
   *   crystal : 冲刺残影碎片，随机朝向的细长菱形
   */
  function pushParticle(o) {
    if (o.life === undefined) o.life = 0.4;
    if (o.maxLife === undefined) o.maxLife = o.life;
    if (o.vx === undefined) o.vx = 0;
    if (o.vy === undefined) o.vy = 0;
    if (o.drag === undefined) o.drag = o.streak ? 1 : 0.92;
    if (o.color === undefined) o.color = '#ffffff';
    particles.push(o);
    return o;
  }

  /** 冲刺方向的垂直向量，用来把碎片/火星撒成一条"刀锋平面" */
  function perpOf(dx, dy) {
    const len = Math.hypot(dx, dy) || 1;
    return { x: -dy / len, y: dx / len };
  }

  function burst(x, y, color, count, speed) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(speed * 0.4, speed);
      pushParticle({
        x: x, y: y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(0.2, 0.5),
        maxLife: 0.5,
        color: color
      });
    }
  }

  /** 冲刺起步：沿冲刺方向喷出一层碎片 + 速度线 */
  function spawnDashBurst(x, y, dx, dy) {
    const per = perpOf(dx, dy);
    const back = Math.atan2(-dy, -dx);

    // 1) 向后炸开的火星
    for (let i = 0; i < 16; i++) {
      const a = back + rand(-0.6, 0.6);
      const s = rand(150, 430);
      pushParticle({
        x: x + per.x * rand(-6, 6), y: y + per.y * rand(-6, 6),
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(0.16, 0.34), color: i % 3 === 0 ? '#ffffff' : '#9be8ff'
      });
    }

    // 2) 垂直散开的晶体碎片
    for (let i = 0; i < 10; i++) {
      const off = rand(-13, 13);
      const a = Math.atan2(per.y, per.x) + rand(-0.9, 0.9);
      const s = rand(80, 260);
      pushParticle({
        x: x + per.x * off, y: y + per.y * off,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(0.2, 0.42), color: '#d6feff',
        crystal: { w: rand(2, 4), h: rand(5, 13), angle: a }
      });
    }

    // 3) 两条向前拉出的速度线
    for (let i = 0; i < 6; i++) {
      const off = rand(-10, 10);
      pushParticle({
        x: x + per.x * off - dx * 8, y: y + per.y * off - dy * 8,
        vx: dx * rand(240, 340) + per.x * off * 14,
        vy: dy * rand(240, 340) + per.y * off * 14,
        life: rand(0.12, 0.22), drag: 0.86,
        color: '#eaffff', trail: { len: rand(7, 13), w: 2.1 }
      });
    }
  }

  /** 把朝向向量归一化写进 out（鼠标还没动过时沿用玩家当前朝向） */
  function aimDir(out) {
    let dx;
    let dy;

    if (aim.has) {
      // 鼠标屏幕坐标 -> 世界坐标，再取"玩家指向鼠标"的方向
      dx = aim.x + camera.x - player.x;
      dy = aim.y + camera.y - player.y;
    } else {
      dx = player.facing.x;
      dy = player.facing.y;
    }

    const len = Math.hypot(dx, dy);
    if (len < 0.0001) {
      out.x = player.facing.x || 1;
      out.y = player.facing.y || 0;
      return out;
    }
    out.x = dx / len;
    out.y = dy / len;
    return out;
  }

  /**
   * 拔刀半圆半径 —— 核心机制：
   * 按玩家当前的"子弹数量增益"（多重射击 BUFF，player.projectiles）缩放。
   * 每多一颗子弹，半圆就更大一圈。
   */
  function bladeRadius() {
    const extra = Math.max(0, player.projectiles - 1);
    return Math.min(
      CONFIG.blade.radiusMax,
      CONFIG.blade.radiusBase + extra * CONFIG.blade.radiusPerBullet
    );
  }

  /** 当前自动射击间隔（拔刀状态攻速翻倍 -> 间隔减半） */
  function effectiveFireInterval() {
    const base = Math.max(0.02, player.fireInterval);
    return player.blade > 0 ? base / CONFIG.blade.attackMul : base;
  }

  /** 当前移动速度（拔刀状态移速翻倍） */
  function effectiveSpeed() {
    return player.speed * (player.blade > 0 ? CONFIG.blade.speedMul : 1);
  }

  /** 拔刀挥砍的冷却：拔刀状态下享受攻速加成（冷却减半） */
  function effectiveSlashCooldown() {
    const base = CONFIG.blade.slash.cooldown;
    return player.blade > 0 ? base / CONFIG.blade.attackMul : base;
  }

  /**
   * 半圆（扇形）范围判定 —— 左键挥砍与大招斩击共用。
   *
   * 严格按"距离 + 角度"双条件判定，覆盖屏幕上画出的整个半圆：
   *   1) 距离：敌人到玩家中心的距离 <= range + 敌人半径（宽容度，边缘的怪也砍得到）
   *   2) 角度：敌人相对玩家的方位角 与 半圆中轴（玩家朝向）的夹角 <= half
   *      half = π/2 时就是"左右各 90°"，合计 180° 半圆，与 drawBladeCone /
   *      drawMeleeSlash 用 ctx.arc(cx, cy, r, angle-half, angle+half) 画出的扇形完全一致。
   *
   * 注意：这是**范围伤害**，不是单体/最近目标 —— 半圆内有多少敌人就打多少。
   */
  function coneHitEnemies(px, py, dirAngle, range, half, pad) {
    const out = [];
    const reach = range + (pad || 0);
    const r2 = reach * reach;

    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const dx = e.x - px;
      const dy = e.y - py;

      // ---- 条件 1：距离 ----
      const d2 = dx * dx + dy * dy;
      // 敌人半径折算成判定宽松量：用圆心距离比较，靠 pad 覆盖贴边的怪
      if (d2 > r2) continue;

      // ---- 条件 2：角度（把差值归一化到 -π ~ π，避免跨 ±180° 判断错误）----
      let diff = Math.atan2(dy, dx) - dirAngle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > half) continue;

      out.push(e);
    }
    return out;
  }

  /**
   * 扇形是否刮到 Boss？
   * Boss 太大了，不能像小怪那样只判定中心点（否则贴脸挥砍会"砍不到"）。
   * 这里用它的四个角 + 中心一起去撞扇形（距离 + 角度），任何一点在扇形内就算命中。
   */
  function coneHitsBoss(px, py, dirAngle, range, half, b) {
    if (!b) return false;

    const h = b.size * 0.5;
    const pts = [
      [b.x, b.y],
      [b.x - h, b.y - h], [b.x + h, b.y - h],
      [b.x - h, b.y + h], [b.x + h, b.y + h]
    ];

    for (let i = 0; i < pts.length; i++) {
      const dx = pts[i][0] - px;
      const dy = pts[i][1] - py;
      if (dx * dx + dy * dy > range * range) continue;

      let diff = Math.atan2(dy, dx) - dirAngle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) <= half) return true;
    }
    return false;
  }

  // ------------------------------------------------------------
  //  源氏：Shift 冲刺
  // ------------------------------------------------------------
  function startDash() {
    if (game.over || game.paused || game.choosing) return false;
    if (player.dashTime > 0 || player.dashCd > 0) return false;   // 冷却中

    const d = aimDir({ x: 0, y: 0 });
    player.dashDx = d.x;
    player.dashDy = d.y;
    player.facing.x = d.x;
    player.facing.y = d.y;

    player.dashTime = CONFIG.dash.duration;
    player.dashCd = CONFIG.dash.cooldown;   // 8 秒
    player.invuln = Math.max(player.invuln, CONFIG.dash.invuln);

    trailTimer = 0;
    afterimages.length = 0;
    clearDashHitMarks();                    // 新的一次冲刺：清掉上一次的命中标记
    spawnDashBurst(player.x, player.y, d.x, d.y);
    // 冲刺音效：Web Audio 实时合成的"嗖"（不读取任何音频文件）
    playDashWhoosh();
    return true;
  }

  /**
   * 冲刺伤害。
   *
   * 规则（见 CONFIG.dash.damage 的注释）：
   *   - 冲刺过程中，玩家碰到敌人 -> 对敌人造成一次冲刺伤害；
   *   - 每个敌人在**单次冲刺**里只会被打中一次（e.dashHit 标记，startDash 时统一清零）；
   *   - 打死敌人照常走 killEnemy -> 会重置冲刺冷却（冲刺击杀也能刷新 Shift）。
   */
  function dashDamage() {
    return CONFIG.dash.damage * player.attackMul;
  }

  /** 清掉所有敌人的"本次冲刺已命中"标记 */
  function clearDashHitMarks() {
    for (let i = 0; i < enemies.length; i++) enemies[i].dashHit = false;
  }

  /**
   * 冲刺撞人结算（每帧调用，只在冲刺中生效）。
   * 先收集命中目标再统一结算：killEnemy 会 splice 修改 enemies 数组，
   * 边遍历边删除会漏怪/错位。
   */
  function applyDashDamage() {
    if (player.dashTime <= 0) return 0;

    const victims = [];
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e.dashHit) continue;   // 本次冲刺已经打过了
      // 玩家当作一个方块，和敌人的圆做碰撞（冲刺时体积略微放宽一点，手感更"撞得到"）
      if (circleRectHit(e.x, e.y, e.size * 0.5, player.x, player.y, player.size + 6)) {
        victims.push(e);
      }
    }
    if (victims.length === 0) return 0;

    const dmg = dashDamage();
    let hitCount = 0;

    for (let i = 0; i < victims.length; i++) {
      const e = victims[i];
      if (e.dashHit) continue;
      e.dashHit = true;          // 本次冲刺对它的唯一一次伤害
      hitCount++;

      e.hp -= dmg;
      e.flash = 0.14;

      // 撞击反馈：把敌人沿冲刺方向推出去一点，并溅出刀锋火星
      e.x += player.dashDx * 9;
      e.y += player.dashDy * 9;
      spawnHitSparks(e.x, e.y, Math.atan2(player.dashDy, player.dashDx), 3);

      if (e.hp <= 0) killEnemy(e);   // 冲刺击杀 -> 内部会重置冲刺冷却
    }

    if (hitCount > 0) {
      playSfx('hit');
      game.shake = Math.max(game.shake, 0.12);
    }
    return hitCount;
  }

  /**
   * 冲刺撞 Boss：同样享受"一次冲刺只结算一次"的规则，
   * 但 Boss 不会被推动；撞完把玩家弹开一点，避免整个人卡在方块里。
   */
  function applyDashDamageToBoss() {
    if (!boss || player.dashTime <= 0) return false;
    if (boss.dashHit) return false;
    if (!circleRectHit(boss.x, boss.y, boss.size * 0.5, player.x, player.y,
                       player.size + 6)) {
      return false;
    }

    boss.dashHit = true;
    spawnHitSparks(boss.x, boss.y, Math.atan2(player.dashDy, player.dashDx), 6);
    playSfx('hit');
    game.shake = Math.max(game.shake, 0.16);

    // 把玩家从方块里推出来（沿冲刺方向继续走一点，不会被"吸"在 Boss 身上）
    player.x += player.dashDx * (boss.size * 0.5 + player.size * 0.6);
    player.y += player.dashDy * (boss.size * 0.5 + player.size * 0.6);
    player.dashTime = 0;      // 冲刺被 Boss 挡住，立刻结束，手感更实

    damageBoss(dashDamage());
    return true;
  }

  /** 击杀敌人时立刻重置冲刺冷却（源氏的"刷新"手感） */
  function resetDash() {
    if (player.dashCd > 0) {
      player.dashCd = 0;
      afterimages.length = 0;
      burst(player.x, player.y, '#7ef0ff', 10, 240);
    }
  }

  // ------------------------------------------------------------
  //  源氏：Q 大招（竜神の剣を喰らえ）
  //  - 能量满 100 才能放
  //  - 释放瞬间：清除朝鼠标方向的半圆内所有敌人并造成大量伤害
  //  - 之后进入 8 秒拔刀状态：攻速 / 移速翻倍 + 半圆视觉
  // ------------------------------------------------------------
  function addEnergy(amount) {
    if (game.over) return;
    game.energy = Math.min(CONFIG.blade.energyMax, game.energy + amount);
  }

  /**
   * 现在能不能攒能量？
   * 关键规则：**拔刀状态（大招的 8 秒内）完全不回能** —— 命中不回、击杀也不回。
   * 释放 Q 的瞬间能量就清零了，必须等拔刀结束、回到正常状态后才重新开始积攒。
   * 另外大招自身斩杀结算期间（ultKilling）也不回能，避免一次清场立刻攒满。
   */
  function canGainEnergy() {
    return player.blade <= 0 && !ultKilling;
  }

  /** 只有能攒能量时才真正加（统一入口，避免各处漏判） */
  function gainEnergy(amount) {
    if (!canGainEnergy()) return false;
    addEnergy(amount);
    return true;
  }

  function isEnergyFull() {
    return game.energy >= CONFIG.blade.energyMax;
  }

  const slashFx = [];
  let ultKilling = false;   // 大招斩杀结算中（此时击杀不回能）

  /** 释放瞬间的"半圆斩"：命中判定 + 视觉 */
  function performBladeSlash() {
    const d = aimDir({ x: 0, y: 0 });
    const angle = Math.atan2(d.y, d.x);

    player.facing.x = d.x;
    player.facing.y = d.y;

    const radius = bladeRadius();
    const half = CONFIG.blade.angleHalf;
    const dmg = CONFIG.blade.damage * player.attackMul;
    const victims = coneHitEnemies(player.x, player.y, angle, radius, half);
    const hitBoss = coneHitsBoss(player.x, player.y, angle, radius, half, boss);

    // 先判定再统一结算：killEnemy 会改动 enemies 数组
    ultKilling = true;
    try {
      for (let i = 0; i < victims.length; i++) {
        const e = victims[i];
        // 半圆内即是"处决"：大招必须真的清场。
        // 仍然按配置的伤害扣血（血厚的怪会显示掉血量），但一旦血量被打空
        // 或者本身就在斩杀线内，就直接归零 -> 保证"清除范围内所有敌人"。
        e.hp -= dmg;
        e.flash = 0.16;
        if (e.hp <= 0 || dmg >= e.maxHp) e.hp = 0;
        killEnemy(e);                  // 击杀 -> 重置冲刺冷却（不回能）
      }
      // Boss 不能被秒杀，但会吃到同一份大招伤害（通常一刀几千，很爽）
      if (hitBoss) damageBoss(dmg);
    } finally {
      ultKilling = false;
    }

    // 视觉：半圆斩击特效
    slashFx.push({
      x: player.x, y: player.y, angle: angle, radius: radius,
      life: 0.45, maxLife: 0.45, style: 'ult'
    });

    game.shake = 0.4;
    burst(player.x, player.y, '#bff3ff', 46, 620);

    // 粒子：沿半圆刀锋撒一圈火星 + 三条向外扫的弧形刀光
    spawnSlashEffect(player.x, player.y, angle, radius, victims.length);
    for (let i = 0; i < victims.length; i++) {
      spawnHitSparks(victims[i].x, victims[i].y, angle, 6);
    }

    return { radius: radius, angle: angle, hits: victims.length };
  }

  /**
   * 拔刀状态（Q 大招 8 秒内）下的鼠标左键挥砍。
   *
   * 关键：这是**半圆范围伤害**，覆盖屏幕上画出来的那块半圆。
   *   - 半径 = bladeRadius()（随"子弹数量增益"放大，190 -> 620），与
   *     drawBladeCone / drawMeleeSlash 画出的半圆半径是同一个函数、同一个值。
   *   - 角度 = 玩家朝向（拔刀状态下每帧跟随鼠标）左右各 90°，合计 180°。
   *   - 半圆内**所有**敌人都会各自受到一次挥砍伤害，并各自计入吸血。
   *   - 不会再出现"只打到最近的一个敌人"或"只打一条直线"的情况。
   */
  function startSlash() {
    if (game.over || game.paused || game.choosing) return false;
    if (player.blade <= 0) return false;        // 只有拔刀状态能挥砍
    if (player.slashCd > 0) return false;       // 冷却中

    const cfg = CONFIG.blade.slash;
    const half = cfg.angleHalf;                 // π/2 -> 左右各 90°，共 180°

    // 朝向：拔刀状态下就是鼠标方向（updatePlayer 也每帧同步 facing，保证画面同步）
    const d = aimDir({ x: 0, y: 0 });
    const angle = Math.atan2(d.y, d.x);
    player.facing.x = d.x;
    player.facing.y = d.y;

    player.slashCd = effectiveSlashCooldown();

    // ---- 伤害半径：与半圆特效**同一个来源**，随子弹数量增益动态缩放 ----
    const radius = bladeRadius() * cfg.radiusMul;

    // ---- 范围判定：距离 + 角度 双重判定，命中半圆内所有敌人 ----
    const victims = coneHitEnemies(player.x, player.y, angle, radius, half, cfg.hitPad);
    const hitBoss = coneHitsBoss(player.x, player.y, angle, radius, half, boss);

    // ---- 逐个结算伤害（killEnemy 会改动 enemies 数组，所以先判定、后统一结算）----
    const dmg = cfg.damage * player.attackMul;
    let killed = 0;

    for (let i = 0; i < victims.length; i++) {
      const e = victims[i];
      e.hp -= dmg;
      e.flash = 0.12;
      if (e.hp <= 0) { killEnemy(e); killed++; }   // 普通击杀：拔刀结束后才回能 + 重置冲刺冷却
    }

    // ---- Boss 吃同一份挥砍伤害 + 一起算吸血 ----
    if (hitBoss) damageBoss(dmg);

    // ---- 大招吸血：半圆内每命中一个敌人回复少量生命（Boss 也算一个"命中"）----
    const hitCount = victims.length + (hitBoss ? 1 : 0);
    let healed = 0;
    if (hitCount > 0 && player.hp < player.maxHp) {
      const before = player.hp;
      player.hp = Math.min(player.maxHp, player.hp + cfg.lifesteal * hitCount);
      healed = player.hp - before;
      if (healed > 0) {
        player.healFlash = 0.25;                                   // 玩家闪绿光
        burst(player.x, player.y, '#6bff9e', 6, 160);              // 绿色治疗粒子
      }
    }

    // ---- 视觉：与判定区域同半径、同角度、同角宽的半圆刀光 ----
    slashFx.push({
      x: player.x, y: player.y, angle: angle, radius: radius,
      life: 0.28, maxLife: 0.28, style: 'melee',
      hits: victims.length, healed: healed
    });

    // ---- 粒子特效：沿整个半圆刀锋撒火星 + 弧形刀光拖尾 + 命中点刀痕 ----
    spawnSlashEffect(player.x, player.y, angle, radius, victims.length);
    for (let i = 0; i < victims.length; i++) {
      spawnHitSparks(victims[i].x, victims[i].y, angle, 4);
    }

    playSfx('hit');

    return {
      hits: victims.length,        // 半圆内被砍到的敌人数
      killed: killed,
      healed: healed,
      radius: radius,              // 本次判定用的半径（= 半圆特效半径）
      cooldown: player.slashCd
    };
  }

  /** 释放大招：能量清零 + 进入拔刀状态 */
  function useUltimate() {
    if (game.over || game.paused || game.choosing) return false;
    if (!isEnergyFull()) return false;

    game.energy = 0;
    game.ultimates++;
    player.blade = CONFIG.blade.duration;   // 8 秒拔刀状态

    playSfx('ultimate');                    // 大招音效（kill.mp3）

    return performBladeSlash();
  }

  // ------------------------------------------------------------
  //  生成
  // ------------------------------------------------------------
  /**
   * 三种敌人的外观 / 数值模板。
   *   normal : 红色方怪 —— 基础追击型（原版行为，只加了种类字段）
   *   fast   : 黄色小怪 —— 更小、更快、血更少
   *   ranged : 紫色远程 —— 不贴脸，停在 stopDist 外每 2 秒朝玩家当前位置开火
   * 数值都从 CONFIG.enemy 派生，方便统一调参。
   */
  const ENEMY_TYPES = {
    normal: {
      kind: 'normal',
      size: CONFIG.enemy.size,
      speed: CONFIG.enemy.speed,
      hpMul: 1,
      damageMul: 1,
      color: CONFIG.enemy.color,
      stopDist: 0,          // 0 = 一直追
      resumeDist: 0
    },
    fast: {
      kind: 'fast',
      size: CONFIG.enemy.fast.size,
      speed: CONFIG.enemy.speed * CONFIG.enemy.fast.speedMul,
      hpMul: CONFIG.enemy.fast.hpMul,
      damageMul: CONFIG.enemy.fast.damageMul,
      color: CONFIG.enemy.fast.color,
      stopDist: 0,
      resumeDist: 0
    },
    ranged: {
      kind: 'ranged',
      size: CONFIG.enemy.ranged.size,
      speed: CONFIG.enemy.speed * CONFIG.enemy.ranged.speedMul,
      hpMul: CONFIG.enemy.ranged.hpMul,
      damageMul: CONFIG.enemy.ranged.damageMul,
      color: CONFIG.enemy.ranged.color,
      activeDist: CONFIG.enemy.ranged.activeDist,
      resumeDist: CONFIG.enemy.ranged.resumeDist
    }
  };

  /**
   * 抽一个敌人种类：按 CONFIG.enemy.typeWeights 加权随机。
   *   - 远程（紫色）占比约 10%，前期更低 -> 屏幕不会被弹幕糊满
   *   - 前 10 秒不出紫色，10~35 秒再逐步回到正常概率 -> 开局不会一上来就被放冷枪
   * 另外：场上紫色怪达到上限时，抽到紫色会退化成普通怪（见 spawnEnemy）。
   */
  function pickEnemyKind() {
    const w = CONFIG.enemy.typeWeights;
    const wFast = w.fast;
    let wRanged = w.ranged;

    if (game.time < 10) {
      wRanged = 0;
    } else if (game.time < 35) {
      wRanged *= (game.time - 10) / 25;   // 0 -> 1 平滑过渡，避免 10 秒时突然冒出
    }

    const total = w.normal + wFast + wRanged;
    let r = Math.random() * (total > 0 ? total : 1);

    r -= w.normal;
    if (r <= 0) return 'normal';
    r -= wFast;
    if (r <= 0) return 'fast';
    return wRanged > 0 ? 'ranged' : 'normal';
  }

  /** 场上当前有多少只远程（紫色）敌人 */
  function countRangedEnemies() {
    let n = 0;
    for (let i = 0; i < enemies.length; i++) {
      if (enemies[i].kind === 'ranged') n++;
    }
    return n;
  }

  function spawnEnemy(kind) {
    if (enemies.length >= CONFIG.enemy.maxCount) return null;

    // 紫色怪有独立上限：抽到紫色但已经满了 -> 退化成普通怪，而不是硬塞
    if (kind === 'ranged' && countRangedEnemies() >= CONFIG.enemy.ranged.maxAlive) {
      kind = 'normal';
    }

    const type = ENEMY_TYPES[kind] || ENEMY_TYPES.normal;
    const half = type.size / 2;

    // 在玩家周围的环带里随机取点 -> 生成在屏幕外，不会直接贴脸。
    // 落在岩石里的点直接重抽（否则怪会一出生就被石头挤住，看着像卡住不动）。
    let x = 0;
    let y = 0;
    let placed = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = rand(CONFIG.enemy.minSpawnDist, CONFIG.enemy.maxSpawnDist);
      x = Math.max(half, Math.min(CONFIG.world.width - half,
        player.x + Math.cos(angle) * radius));
      y = Math.max(half, Math.min(CONFIG.world.height - half,
        player.y + Math.sin(angle) * radius));
      if (!circleHitsAnyRock(x, y, half + 2)) {
        placed = true;
        break;
      }
    }
    if (!placed) return null;   // 周围实在没地方了（几乎不会发生），这一只就不刷

    return pushEnemy(makeEnemy(type, x, y));
  }

  /**
   * 造一只小怪（不放进数组），所有字段都在这里统一赋值。
   * 血量 / 移速会乘上 raid 的轮次成长 -> 每打赢一次 Boss，下一轮的小怪更硬更快，
   * 但只对新刷出来的怪生效（场上的怪保持原样）。
   */
  function makeEnemy(type, x, y) {
    // 血量成长对三种敌人一视同仁，只是乘上各自的血量倍率
    const bonusHp = Math.floor(game.time / CONFIG.enemy.hpGrowthEvery) *
      CONFIG.enemy.hpGrowthAmount;
    const baseHp = CONFIG.enemy.hp + bonusHp;
    const maxHp = Math.max(1, Math.round(baseHp * type.hpMul * raidHpMul()));

    const e = {
      kind: type.kind,
      x: x, y: y,
      size: type.size,
      speed: type.speed * rand(0.88, 1.12) * raidSpeedMul(),
      hp: maxHp,
      maxHp: maxHp,
      damage: CONFIG.enemy.damage * type.damageMul,
      color: type.color,
      stopDist: type.stopDist,        // 仅近战怪使用（0 = 一直追）
      activeDist: type.activeDist,    // 仅远程怪使用：进入这个距离才停下开火
      resumeDist: type.resumeDist,
      contact: true,      // 撞到玩家是否造成伤害
      pushDist: 0,        // 撞完之后把自己推开多少（防止一直贴着）
      hostile: false,     // 是否会朝玩家开枪
      fireCd: 0,
      bullets: 0,
      flash: 0,
      dashHit: false      // 本次冲刺是否已经伤过它（冲刺伤害只结算一次）
    };

    if (type.kind === 'ranged') {
      e.hostile = true;
      e.contact = false;    // 远程怪不靠撞击掉血，它负责放冷枪
      // 出生后先追人，进入 activeDist 停住后才开始数第一发的延迟；
      // 这里只做一个较小的随机抖动，避免多只紫色怪同时开火。
      e.fireCd = CONFIG.enemy.ranged.fireDelay * rand(0.4, 1.0);
    }

    return e;
  }

  /** 把怪放进场上（统一入口，Boss 战期间也用它来补充"残余小怪"） */
  function pushEnemy(e) {
    enemies.push(e);
    return e;
  }

  /** 刷怪波次：每一只都按权重随机抽种类 */
  function spawnWave() {
    const count = Math.min(
      CONFIG.enemy.maxSpawnCount,
      CONFIG.enemy.spawnCount + Math.floor(game.time / CONFIG.enemy.growthEvery)
    );
    for (let i = 0; i < count; i++) spawnEnemy(pickEnemyKind());
  }

  /** 找最近的敌人；场上没有小怪时退而求其次瞄准 Boss（否则会站着不开枪） */
  function findNearestEnemy(x, y) {
    let best = null;
    let bestD2 = Infinity;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const d2 = dist2(x, y, e.x, e.y);
      if (d2 < bestD2) { bestD2 = d2; best = e; }
    }
    if (!best && boss) return boss;
    return best;
  }

  function fireBullet() {
    const target = findNearestEnemy(player.x, player.y);
    if (!target) return;   // 没敌人就不浪费子弹

    const dx = target.x - player.x;
    const dy = target.y - player.y;
    const len = Math.hypot(dx, dy) || 1;
    const baseAngle = Math.atan2(dy, dx);
    const muzzle = player.size * 0.5 + 6;

    // 子弹依旧是自动瞄准最近的敌人；拔刀状态下朝向交给鼠标（见 updatePlayer）
    if (player.blade <= 0) {
      player.facing.x = dx / len;
      player.facing.y = dy / len;
    }

    const damage = (CONFIG.bullet.damage + player.attackFlat) * player.attackMul;

    // 多重射击：围绕瞄准方向均匀散开
    const n = player.projectiles;
    const spread = 0.16;   // 相邻两颗子弹的角度差（弧度）
    for (let i = 0; i < n; i++) {
      const angle = baseAngle + (i - (n - 1) / 2) * spread;
      const nx = Math.cos(angle);
      const ny = Math.sin(angle);

      bullets.push({
        x: player.x + nx * muzzle,
        y: player.y + ny * muzzle,
        // px/py 与出生点保持一致：第一帧的线段碰撞（岩石 / 敌人）才有正确的起点
        px: player.x + nx * muzzle,
        py: player.y + ny * muzzle,
        vx: nx * CONFIG.bullet.speed,
        vy: ny * CONFIG.bullet.speed,
        radius: CONFIG.bullet.radius,
        damage: damage,
        traveled: 0
      });
    }

    // 每轮开火只响一次（多重射击时不会连响）
    playSfx('shoot');
  }

  function hurtPlayer(amount) {
    if (player.invuln > 0 || game.over) return;

    player.hp -= amount;
    player.invuln = CONFIG.player.invulnTime;
    player.flash = 0.18;
    game.shake = 0.22;
    burst(player.x, player.y, '#ff7b7b', 8, 200);

    if (player.hp <= 0) {
      player.hp = 0;
      game.over = true;
      burst(player.x, player.y, CONFIG.player.color, 40, 420);
    }
  }

  // ------------------------------------------------------------
  //  经验与升级
  // ------------------------------------------------------------
  const XP = {
    base: 5,        // 1 级升 2 级需要 5 点
    growth: 1.32,   // 每级需求 ×1.32
    perOrb: 4       // 每个经验球给的额外经验（升级会乘 player.xpMul）
  };

  /**
   * 增益池。weight 越大越容易抽到；
   * apply() 里改的都是 player 上的数值，立即生效。
   */
  const UPGRADES = [
    {
      id: 'atk', icon: '⚔', name: '攻击力 +20%', weight: 10, accent: '#ff7b7b',
      desc: '子弹伤害提升 20%',
      apply: function () { player.attackMul *= 1.2; }
    },
    {
      id: 'atkFlat', icon: '🗡', name: '攻击力 +5', weight: 8, accent: '#ff9f6b',
      desc: '子弹伤害固定 +5',
      apply: function () { player.attackFlat += 5; }
    },
    {
      id: 'atkSpeed', icon: '⚡', name: '攻击速度 +15%', weight: 10, accent: '#ffd93d',
      desc: '自动射击间隔缩短 15%',
      apply: function () { player.fireInterval *= 0.85; }
    },
    {
      id: 'speed', icon: '👟', name: '移动速度 +20%', weight: 10, accent: '#6cb2ff',
      desc: '跑得更快，方便拉扯走位',
      apply: function () { player.speed *= 1.2; }
    },
    {
      id: 'maxHp', icon: '❤', name: '生命上限 +20%', weight: 9, accent: '#57e07a',
      desc: '生命上限提升 20%，并立刻回满血',
      apply: function () {
        player.maxHp = Math.round(player.maxHp * 1.2);
        player.hp = player.maxHp;
      }
    },
    {
      id: 'heal', icon: '✚', name: '治疗 50%', weight: 7, accent: '#4ad66d',
      desc: '立刻恢复一半血量',
      apply: function () { player.hp = Math.min(player.maxHp, player.hp + player.maxHp * 0.5); }
    },
    {
      id: 'xp', icon: '★', name: '经验获取 +25%', weight: 7, accent: '#c78bff',
      desc: '经验球提供的经验提升 25%',
      apply: function () { player.xpMul *= 1.25; }
    },
    {
      id: 'pickup', icon: '🧲', name: '拾取范围 +50%', weight: 7, accent: '#57e07a',
      desc: '经验球吸取距离和速度都提升 50%',
      apply: function () {
        player.pickupDist *= 1.5;
        player.attractSpeed *= 1.5;
      }
    },
    {
      id: 'multi', icon: '🔱', name: '多重射击 +1', weight: 3, accent: '#ff5fa2',
      desc: '每次开火多射出一颗子弹（可叠加）',
      apply: function () { player.projectiles += 1; }
    }
  ];

  const upgradeState = {
    pending: 0,     // 还没结算的升级次数
    options: [],    // 当前面板上的 3 个选项
    picked: 0       // 本次局内已选择的次数
  };

  /** 按权重随机抽 n 个不重复的增益 */
  function rollUpgrades(n) {
    const pool = UPGRADES.slice();
    const result = [];
    while (result.length < n && pool.length > 0) {
      let total = 0;
      for (let i = 0; i < pool.length; i++) total += pool[i].weight;

      let r = Math.random() * total;
      let idx = pool.length - 1;
      for (let i = 0; i < pool.length; i++) {
        r -= pool[i].weight;
        if (r <= 0) { idx = i; break; }
      }
      result.push(pool.splice(idx, 1)[0]);
    }
    return result;
  }

  /** 升级所需经验（随等级递增） */
  function xpNeeded(level) {
    return Math.round(XP.base * Math.pow(XP.growth, level - 1));
  }

  /** 显示升级面板：游戏冻结 + 弹出 3 张卡 */
  function openUpgradePanel() {
    upgradeState.pending--;
    upgradeState.options = rollUpgrades(3);

    optionsEl.textContent = '';
    for (let i = 0; i < upgradeState.options.length; i++) {
      const opt = upgradeState.options[i];

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'upgrade-card';
      btn.style.setProperty('--accent', opt.accent);
      btn.dataset.index = String(i);

      const kbd = document.createElement('kbd');
      kbd.textContent = String(i + 1);

      const icon = document.createElement('div');
      icon.className = 'icon';
      icon.textContent = opt.icon;

      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = opt.name;

      const desc = document.createElement('div');
      desc.className = 'desc';
      desc.textContent = opt.desc;

      btn.appendChild(kbd);
      btn.appendChild(icon);
      btn.appendChild(name);
      btn.appendChild(desc);

      // 直接绑在卡上：点在卡内的文字/图标上也能触发
      // （用事件委托 + e.target.closest 的话，点在文字上会失效）
      btn.addEventListener('click', function () {
        chooseUpgrade(i);
      });

      optionsEl.appendChild(btn);
    }

    game.choosing = true;
    game.paused = false;          // 手动的暂停状态让位给升级面板
    canvas.classList.add('paused-cursor');
    panelEl.classList.add('show');

    // 自动聚焦第一张卡，方便键盘操作
    const first = optionsEl.querySelector('.upgrade-card');
    if (first && first.focus) first.focus();
  }

  function closeUpgradePanel() {
    panelEl.classList.remove('show');
    canvas.classList.remove('paused-cursor');
    optionsEl.textContent = '';
    upgradeState.options = [];
    game.choosing = false;

    // 如果这一波还没结算完，继续弹下一张面板
    if (upgradeState.pending > 0) openUpgradePanel();
  }

  /** 玩家选择第 index 个选项 -> 立即生效 */
  function chooseUpgrade(index) {
    if (!game.choosing) return;
    const opt = upgradeState.options[index];
    if (!opt) return;

    opt.apply();
    upgradeState.picked++;

    burst(player.x, player.y, opt.accent, 26, 320);
    closeUpgradePanel();
  }

  /** 拾取经验球时调用；可能连升多级 */
  function gainXp(amount) {
    if (game.over) return;   // 死亡瞬间还有经验球被吸进来时，不再结算升级
    game.xp += amount * player.xpMul;

    while (game.xp >= game.xpNeed) {
      game.xp -= game.xpNeed;
      game.level++;
      game.xpNeed = xpNeeded(game.level);
      upgradeState.pending++;
      burst(player.x, player.y, '#ffd93d', 30, 360);
      playSfx('levelup');
    }

    // 有升级待结算且当前没在选 -> 弹面板
    if (upgradeState.pending > 0 && !game.choosing) {
      openUpgradePanel();
    }
  }

  // 说明：选项的点击回调在构建卡片时逐个绑定（见 openUpgradePanel）

  // ------------------------------------------------------------
  //  Boss 战
  //  规则：
  //    1) 触发：Boss 进度攒满 100（每击杀一个敌人 +1，见 raid.progress）
  //              或本轮存活计时达到 120 秒（见 raid.fightTime）
  //    2) 触发后停止刷新普通小怪，在玩家附近生成一个巨大的暗红色方块 Boss，
  //       屏幕顶部出现独立血条；
  //    3) Boss 缓慢靠近玩家（太近就绕圈），每 5 秒放一圈弹幕，子弹伤害偏高，
  //       必须靠 Shift 冲刺的无敌帧 / 走位躲开；
  //    4) 击败后掉落大量经验球 + 清空场上残余小怪，5 秒安全期后重新开始刷小怪，
  //       并且下一轮难度略升（门槛递增 + 小怪血量 / 移速微增，
  //       见 bossProgressNeed / bossTriggerTime / raidHpMul / raidSpeedMul）。
  //
  //  重要（防无限循环）：触发用的两个量 —— raid.progress 和 raid.fightTime ——
  //  都会被重置。**玩家的总击杀数 game.kills 和总存活时间 game.time 永远不清零**，
  //  它们只用于 UI 显示和数值成长，因此不会再出现"打过 Boss 后立刻又满足条件"的死循环。
  // ------------------------------------------------------------

  /**
   * 触发条件（只在 idle 阶段判定）：
   *   - Boss 进度攒满本轮所需击杀数（第 1 轮 100，之后每轮 +50）
   *   - 或者本轮存活计时达到本轮门槛（第 1 轮 120 秒，之后每轮 +30 秒）
   * 这里不再直接读 game.kills / game.time，避免"条件一旦满足就永远满足"。
   */
  function bossShouldTrigger() {
    return raid.progress >= bossProgressNeed() || raid.fightTime >= bossTriggerTime();
  }

  /**
   * 击杀敌人 -> 累加 Boss 进度（只加进度，不动 game.kills）。
   * Boss 在场时 / 清场观望期不加（阶段守卫，见 updateRaid 与 killEnemy 的调用点）。
   * 进度到顶就卡在上限，UI 显示不会出现 103/100 这种数字。
   */
  function addBossProgress(amount) {
    if (raid.phase !== 'idle') return false;   // Boss 战中 / 清场期暂停累计
    const need = bossProgressNeed();           // 本轮门槛（随轮次递增）
    if (raid.progress >= need) return false;
    raid.progress = Math.min(need, raid.progress + (amount === undefined ? 1 : amount));
    return true;
  }

  /** 在玩家附近挑一个生成点：不太近（有反应时间）也不太远（看得见） */
  function pickBossSpawnPos() {
    const half = CONFIG.boss.size / 2 + 6;
    const baseAngle = Math.random() * Math.PI * 2;

    for (let attempt = 0; attempt < 24; attempt++) {
      // 第一次用一个"面向玩家、约 520 像素外"的位置：屏幕里能看到它压过来
      const angle = attempt === 0 ? baseAngle : baseAngle + attempt * 0.7;
      const dist = attempt === 0 ? 520 : rand(480, 760);
      const x = Math.max(half, Math.min(CONFIG.world.width - half,
        player.x + Math.cos(angle) * dist));
      const y = Math.max(half, Math.min(CONFIG.world.height - half,
        player.y + Math.sin(angle) * dist));

      // 别落在玩家脸上，也别压在岩石上（Boss 体积 168，陷进石头里会很难看）
      if (dist2(x, y, player.x, player.y) > 300 * 300 &&
          !rectHitsAnyRock(x, y, CONFIG.boss.size)) {
        return { x: x, y: y };
      }
    }
    return { x: CONFIG.world.width / 2, y: CONFIG.world.height / 2 };
  }

  /** 清空场上所有残余小怪（Boss 登场 / 被击败时用） */
  function clearAllEnemies(silent) {
    const n = enemies.length;
    while (enemies.length) {
      const e = enemies[enemies.length - 1];
      enemies.pop();
      if (!silent) burst(e.x, e.y, e.color || CONFIG.enemy.color, 8, 240);
    }
    return n;
  }

  /**
   * 生成 Boss，并进入 boss 阶段（停止刷新普通小怪）。
   * 三重守卫，确保 Boss 在场时绝不会再触发一次生成：
   *   1) 已经有 boss 对象
   *   2) 阶段不是 idle（boss 战 / 清场期都不允许）
   *   3) 游戏已结束
   */
  function startBossRaid() {
    if (boss) return null;
    if (raid.phase !== 'idle') return null;
    if (game.over) return null;

    const cfg = CONFIG.boss;
    const pos = pickBossSpawnPos();

    // ★ Boss 生成这一刻：先按"本轮已经打了多久"算血量（bossMaxHp 用 raid.fightTime），
    //   再暂停进度累计、把本轮存活计时归零（击败后重新从 0 开始算本轮门槛）
    //   progress 冻结在本轮门槛上时 UI 显示 100/100（第二轮 150/150）；
    //   fightTime 保持为 0，直到被打赢
    const hp = bossMaxHp();
    raid.phase = 'boss';
    raid.fightTime = 0;

    boss = {
      x: pos.x, y: pos.y,
      size: cfg.size,
      hp: hp,
      maxHp: hp,
      speed: cfg.speed,
      damage: cfg.damage * bossDamageMul(),
      color: cfg.color,
      flash: 0,
      dashHit: false,
      angle: Math.atan2(pos.y - player.y, pos.x - player.x),  // 绕圈用的极角
      orbitDir: Math.random() < 0.5 ? 1 : -1,
      barrageCd: cfg.barrageInterval * 0.55,   // 登场后先给玩家一点缓冲
      pendingWaves: 0,
      waveCd: 0,
      spin: 0,
      contactCd: 0,
      spawnTime: game.time
    };

    spawnTimer = 0;                       // 丢掉攒着的刷怪计时器
    clearAllEnemies();                    // Boss 独占舞台（击杀不计入）
    burst(boss.x, boss.y, cfg.edgeColor, 60, 620);
    shockRings.push({
      x: boss.x, y: boss.y, r: boss.size * 0.6, fromR: boss.size * 0.6, maxR: boss.size * 3.2,
      life: 0.7, maxLife: 0.7, color: cfg.edgeColor, width: 6
    });
    playSfx('ultimate', 0.7);
    game.shake = Math.max(game.shake, 0.55);

    showBanner('BOSS 来袭 ！', cfg.announceTime);
    return boss;
  }

  /** Boss 弹幕：以 Boss 为中心向四周铺满一圈子弹（可躲，靠走位/冲刺穿缝隙） */
  function fireBossBarrage() {
    if (!boss) return 0;

    const cfg = CONFIG.boss;
    const muzzle = boss.size * 0.5 + cfg.muzzleGap;
    const base = boss.pendingSpin !== undefined ? boss.pendingSpin : 0;
    const n = cfg.barrageArms;

    for (let i = 0; i < n; i++) {
      const a = base + (i / n) * Math.PI * 2;
      const nx = Math.cos(a);
      const ny = Math.sin(a);
      bullets.push({
        x: boss.x + nx * muzzle,
        y: boss.y + ny * muzzle,
        px: boss.x + nx * muzzle,
        py: boss.y + ny * muzzle,
        vx: nx * cfg.bulletSpeed,
        vy: ny * cfg.bulletSpeed,
        radius: cfg.bulletRadius,
        color: cfg.edgeColor,
        damage: cfg.bulletDamage,
        hostile: true,
        bossBullet: true,
        traveled: 0,
        range: cfg.bulletRange
      });
    }

    // 开火时的冲击环（纯视觉）
    shockRings.push({
      x: boss.x, y: boss.y, r: boss.size * 0.5, fromR: boss.size * 0.5, maxR: boss.size * 1.5,
      life: 0.3, maxLife: 0.3, color: cfg.edgeColor, width: 5
    });
    burst(boss.x, boss.y, cfg.edgeColor, 16, 320);
    playSfx('hit', 0.75);
    return n;
  }

  /** 屏幕中央的横幅提示（Boss 来袭 / 下一轮开始） */
  function showBanner(text, seconds) {
    raid.banner = text;
    raid.bannerTimer = seconds === undefined ? 2.4 : seconds;
  }

  /** 击败 Boss：掉落大量经验球 + 清场 + 进入 5 秒观望，之后重开刷怪 */
  function defeatBoss() {
    if (!boss) return null;

    const cfg = CONFIG.boss;
    const bx = boss.x;
    const by = boss.y;

    // ---- 掉落大量经验球（整圈铺开，捡起来很爽）----
    // 注意：拔刀状态下 killEnemy 不掉球，这里是 Boss 奖励，不受那条规则影响
    for (let i = 0; i < cfg.orbDrop; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = rand(0, boss.size * 1.5);
      orbs.push({
        x: Math.max(6, Math.min(CONFIG.world.width - 6, bx + Math.cos(a) * r)),
        y: Math.max(6, Math.min(CONFIG.world.height - 6, by + Math.sin(a) * r)),
        radius: CONFIG.orb.radius,
        life: 0
      });
    }

    // ---- 清空场上所有残余小怪 ----
    const cleared = clearAllEnemies();

    // ---- 爆炸视觉 + 音效 ----
    burst(bx, by, cfg.coreColor, 70, 700);
    burst(bx, by, '#ffffff', 30, 460);
    shockRings.push({
      x: bx, y: by, r: boss.size * 0.5, fromR: boss.size * 0.5, maxR: boss.size * 6,
      life: 0.85, maxLife: 0.85, color: cfg.coreColor, width: 9
    });
    playSfx('ultimate', 1.25);
    playSfx('levelup');
    game.shake = 0.7;

    const round = raid.round + 1;
    boss = null;
    raid.round = round;
    raid.totalBossKills++;
    raid.phase = 'clear';
    raid.clearTimer = cfg.clearDelay;

    // ★ 击败 Boss 后：Boss 进度清零、本轮存活计时清零
    //   （玩家的总击杀 game.kills / 总存活 game.time 保持不变，只是用于显示和成长）
    //   于是安全期结束后一切从头累计，不会立刻又满足触发条件 -> 不会无限循环
    raid.progress = 0;
    raid.fightTime = 0;

    if (player.hp < player.maxHp) {
      player.hp = Math.min(player.maxHp, player.hp + player.maxHp * 0.25);   // 小奖励：回一口血
      player.healFlash = 0.4;
    }

    showBanner('BOSS 已击败！第 ' + round + ' 轮清场 · ' + cfg.clearDelay.toFixed(0) + ' 秒安全期', cfg.clearDelay);
    return { round: round, cleared: cleared, orbs: cfg.orbDrop };
  }

  /** 对 Boss 造成伤害（子弹 / 冲刺 / 拔刀都走这里） */
  function damageBoss(amount) {
    if (!boss) return false;
    boss.hp -= amount;
    boss.flash = 0.12;
    if (boss.hp <= 0) {
      boss.hp = 0;
      defeatBoss();
      return true;
    }
    return false;
  }

  /**
   * Boss 战阶段机：进度/计时累计、触发判定、清场倒计时、横幅计时。
   *
   * 阶段与两个触发量的关系（这是修掉"无限循环"的关键）：
   *   idle  : fightTime += dt，击杀时 progress += 1
   *           progress 满 100 或 fightTime 满 120 秒 -> startBossRaid()
   *   boss  : fightTime 暂停累计（进度也不加），Boss 在场时不会再触发新 Boss
   *   clear : 5 秒安全期，同样不累计
   *   击败 -> progress = 0、fightTime = 0，安全期结束后从零开始重新累计
   */
  function updateRaid(dt) {
    if (raid.bannerTimer > 0) {
      raid.bannerTimer = Math.max(0, raid.bannerTimer - dt);
      if (raid.bannerTimer === 0) raid.banner = '';
    }

    if (raid.phase === 'idle') {
      // 本轮存活计时（被 Boss 打断后从 0 重新开始；Boss 在场时不会走这里）
      raid.fightTime += dt;

      // 进度满 100 或计时满 2 分钟 -> 开打（Boss 在场时 startBossRaid 自己会拒绝）
      if (bossShouldTrigger()) startBossRaid();
      return;
    }

    if (raid.phase === 'clear') {
      raid.clearTimer -= dt;
      if (raid.clearTimer <= 0) {
        raid.clearTimer = 0;
        boss = null;
        raid.phase = 'idle';
        raid.progress = 0;      // 保险：安全期结束一律从 0 开始重新累计
        raid.fightTime = 0;     // 本轮所需击杀 / 计时门槛由 bossProgressNeed / bossTriggerTime 给出
        spawnTimer = 0;
        // 立刻来一波，让"重新开刷"看得见
        spawnWave();
        showBanner('第 ' + (raid.round + 1) + ' 轮：击杀 ' + bossProgressNeed() +
          ' / 存活 ' + bossTriggerTime() + 's 触发 BOSS · 小怪血量 +' +
          Math.round(raid.round * CONFIG.boss.difficulty.hpStep * 100) + '% · 移速 +' +
          Math.round(raid.round * CONFIG.boss.difficulty.speedStep * 100) + '%', 3.0);
      }
      return;
    }

    // boss 阶段：fightTime 不累计（暂停计时），Boss 自己由 updateBoss 推进。
    // 万一 boss 对象意外丢失，退回 idle，避免卡死在 boss 阶段。
    if (raid.phase === 'boss' && !boss) raid.phase = 'idle';
  }

  const BOSS_BARRAGE_ANGLES = Math.PI * 2 / 20;   // 单颗子弹对应的角宽（画预警缝隙用）

  /**
   * Boss 本体：移动 + 每 5 秒一圈弹幕 + 撞击伤害。
   * 移动是"靠近到一定距离就绕着玩家转圈"：
   *  - 太近时如果还直着撞，Boss 会和玩家糊在一起看不清，
   *    绕圈既能让玩家有机会输出，也逼着玩家不停走位躲弹幕。
   */
  function updateBoss(dt) {
    if (!boss) return;

    const cfg = CONFIG.boss;

    // ---------- 计时器 ----------
    if (boss.flash > 0) boss.flash = Math.max(0, boss.flash - dt);
    if (boss.contactCd > 0) boss.contactCd = Math.max(0, boss.contactCd - dt);
    if (boss.dashHit && player.dashTime <= 0) boss.dashHit = false;

    // ---------- 移动 ----------
    const dx = player.x - boss.x;
    const dy = player.y - boss.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dx / len;
    const ny = dy / len;

    // 用"以玩家为中心"的极角计算绕圈，保证不会一头撞进玩家身体里
    const angle = Math.atan2(boss.y - player.y, boss.x - player.x);
    const orbit = cfg.orbitDist;
    const targetOrbitX = player.x + Math.cos(angle) * orbit;
    const targetOrbitY = player.y + Math.sin(angle) * orbit;

    if (len > cfg.approachDist + 40) {
      // 还很远：径直压过去（很慢）
      boss.x += nx * boss.speed * dt;
      boss.y += ny * boss.speed * dt;
    } else if (len > orbit + 30) {
      // 进入逼近带：往"绕圈轨道"上靠
      const tdx = targetOrbitX - boss.x;
      const tdy = targetOrbitY - boss.y;
      const tlen = Math.hypot(tdx, tdy) || 1;
      boss.x += (tdx / tlen) * boss.speed * dt;
      boss.y += (tdy / tlen) * boss.speed * dt;
    } else {
      // 已经在轨道上：绕着玩家转，保持距离
      const next = angle + boss.orbitDir * cfg.orbitSpeed * dt;
      boss.x += (player.x + Math.cos(next) * len - boss.x) * 0.9;
      boss.y += (player.y + Math.sin(next) * len - boss.y) * 0.9;
    }

    const half = boss.size / 2;
    // 岩石挡 Boss：撞上去会被挤出来（分轴移动，所以它是"贴着石头滑过去"而不是卡死）
    const bossRocked = pushCircleOutOfRocks(boss, half);
    if (bossRocked) {
      boss.x = Math.max(half, Math.min(CONFIG.world.width - half, boss.x));
      boss.y = Math.max(half, Math.min(CONFIG.world.height - half, boss.y));
    }

    // ---------- 每 5 秒一轮弹幕 ----------
    boss.barrageCd -= dt;
    if (boss.barrageCd <= 0 && boss.pendingWaves <= 0) {
      boss.barrageCd += cfg.barrageInterval;
      if (boss.barrageCd <= 0) boss.barrageCd = cfg.barrageInterval;
      boss.pendingWaves = cfg.barrageWaves;
      boss.waveCd = 0;      // 立刻打第一波
      // 预警：地上收缩的红环，告诉玩家"要放弹幕了，准备好 Shift"
      shockRings.push({
        x: boss.x, y: boss.y, r: boss.size * 3.4, fromR: boss.size * 3.4, maxR: boss.size * 0.5,
        life: cfg.telegraph, maxLife: cfg.telegraph,
        color: cfg.coreColor, width: 4, shrink: true
      });
      playSfx('hit', 0.6);
    }

    if (boss.pendingWaves > 0) {
      boss.waveCd -= dt;
      if (boss.waveCd <= 0) {
        boss.pendingWaves--;
        boss.waveCd = cfg.barrageWaveDelay;
        // 波与波之间旋转一点 -> 20 条射线之间会偏移，玩家有缝可钻
        boss.pendingSpin = (boss.pendingSpin || 0) + cfg.barrageSpin;
        if (!game.over) fireBossBarrage();
      }
    }

    // ---------- 撞击玩家 ----------
    if (boss.contactCd <= 0 &&
        circleRectHit(player.x, player.y, player.size * 0.5, boss.x, boss.y, boss.size)) {
      hurtPlayer(boss.damage);
      boss.contactCd = cfg.contactCd;
      // 把玩家往外推一点，避免卡在方块里出不来
      player.x += nx * cfg.contactPush;
      player.y += ny * cfg.contactPush;
      // 被撞飞后可能撞进石头 / 撞出地图：统一收尾一下，防止被顶进掩体里
      settleActor(player, player.size / 2);
      game.shake = Math.max(game.shake, 0.3);
    }
  }

  /** 弹幕预警 / 冲击圆环的推进 */
  function updateShockRings(dt) {
    for (let i = shockRings.length - 1; i >= 0; i--) {
      const r = shockRings[i];
      r.life -= dt;
      const t = Math.max(0, r.life / r.maxLife);   // 1 -> 0
      if (r.shrink) {
        // 由大收小：纯粹的蓄力预警
        const from = (r.fromR === undefined ? r.r : r.fromR);
        r.r = r.maxR + (from - r.maxR) * t;
      } else {
        // 由小扩出去：开火/爆炸的冲击波
        const from = (r.fromR === undefined ? r.r : r.fromR);
        r.r = from + (r.maxR - from) * (1 - t);
      }
      if (r.life <= 0) shockRings.splice(i, 1);
    }
  }

  // ------------------------------------------------------------
  //  更新
  // ------------------------------------------------------------
  function updatePlayer(dt) {
    const half = player.size / 2;

    // ---------- 冲刺计时 / 冷却 ----------
    if (player.dashTime > 0) player.dashTime = Math.max(0, player.dashTime - dt);
    if (player.dashCd > 0) player.dashCd = Math.max(0, player.dashCd - dt);
    if (player.blade > 0) player.blade = Math.max(0, player.blade - dt);
    if (player.slashCd > 0) player.slashCd = Math.max(0, player.slashCd - dt);
    if (player.healFlash > 0) player.healFlash = Math.max(0, player.healFlash - dt);

    // 拔刀状态下朝向跟随鼠标（半圆特效因此实时朝鼠标方向旋转）
    if (player.blade > 0) {
      const d = aimDir({ x: 0, y: 0 });
      player.facing.x = d.x;
      player.facing.y = d.y;
    }

    if (player.invuln > 0) player.invuln = Math.max(0, player.invuln - dt);
    if (player.flash > 0) player.flash = Math.max(0, player.flash - dt);

    // ---------- 冲刺中：沿冲刺方向高速位移，忽略方向键 ----------
    if (player.dashTime > 0) {
      const wasDashing = player.dashTime;
      // 匀速冲刺：位移 = speed × duration ≈ 225 像素，手感干脆可预期
      const step = CONFIG.dash.speed * dt;

      player.x += player.dashDx * step;
      player.y += player.dashDy * step;

      // 冲刺撞上岩石：立刻被挡下来（冲刺距离 225 像素，石头最小边长 60，
      // 速度再快也是"逐帧位移 + 挤出"的组合，不会一帧跨过整块石头）
      settleActor(player, half);

      // 冲刺伤害：位移之后立刻结算，保证"撞到就砍到"（每次冲刺对同一个敌人只算一次）
      applyDashDamage();
      // Boss 也吃冲刺伤害（同样一次冲刺只结算一次）
      applyDashDamageToBoss();

      // 残影
      trailTimer -= dt;
      if (trailTimer <= 0) {
        trailTimer = CONFIG.dash.trailInterval;
        if (afterimages.length < 14) {
          afterimages.push({
            x: player.x, y: player.y,
            size: player.size,
            life: 0.28, maxLife: 0.28,
            // 垂直于冲刺方向的细长菱形：冲刺看起来像一道刀锋划过
            angle: Math.atan2(player.dashDy, player.dashDx),
            w: player.size * 0.55,
            h: player.size * 1.35
          });
        }
        // 拖尾粒子：沿垂直方向散开的青色晶屑，速度继承冲刺方向
        const per = perpOf(player.dashDx, player.dashDy);
        const off = rand(-player.size * 0.45, player.size * 0.45);
        pushParticle({
          x: player.x + per.x * off, y: player.y + per.y * off,
          vx: -player.dashDx * 60 + per.x * rand(-70, 70),
          vy: -player.dashDy * 60 + per.y * rand(-70, 70),
          life: rand(0.16, 0.3),
          color: Math.random() < 0.35 ? '#ffffff' : '#8ef0ff',
          crystal: { w: rand(1.6, 3), h: rand(4, 10), angle: Math.atan2(per.y, per.x) }
        });
      }

      // 冲刺刚结束：清掉命中标记，下一次冲刺对所有敌人重新生效
      if (wasDashing > 0 && player.dashTime <= 0) clearDashHitMarks();
    } else {
      // ---------- 常规移动 ----------
      let dx = 0;
      let dy = 0;

      if (keys['KeyA'] || keys['ArrowLeft']) dx -= 1;
      if (keys['KeyD'] || keys['ArrowRight']) dx += 1;
      if (keys['KeyW'] || keys['ArrowUp']) dy -= 1;
      if (keys['KeyS'] || keys['ArrowDown']) dy += 1;

      if (dx !== 0 && dy !== 0) {
        const inv = 1 / Math.sqrt(2);
        dx *= inv;
        dy *= inv;
      }

      const speed = effectiveSpeed();   // 拔刀状态移速翻倍

      // 按 X / Y 分轴推进：先走一个轴，撞到石头就被挤回来，
      // 另一个轴照常走 —— 这样斜着撞墙会自然"贴着墙面滑动"，
      // 既不会穿模，也不会被石头粘住。
      player.x += dx * speed * dt;
      settleActor(player, half);

      player.y += dy * speed * dt;
      settleActor(player, half);
    }

    // 收尾：无论如何都不允许停在石头里或走出地图
    // （冲刺是高速位移，单帧位移 1500 × dt 最大也才 75 像素 < 石头最小边长，
    //   所以"先位移再挤出来"不会出现穿模）
    settleActor(player, half);
  }

  /** 冲刺残影的衰减 */
  function updateAfterimages(dt) {
    for (let i = afterimages.length - 1; i >= 0; i--) {
      const a = afterimages[i];
      a.life -= dt;
      if (a.life <= 0) afterimages.splice(i, 1);
    }
  }

  /**
   * 左键挥砍的粒子：沿刀锋撒火星 + 三条弧形刀光拖尾 + 命中点的溅射。
   * 注意：只负责"放粒子"，扇形本体的绘制仍在 drawMeleeSlash / drawSlashFx。
   */
  function spawnSlashEffect(cx, cy, angle, range, hits) {
    const power = Math.min(1, 0.5 + hits * 0.16);
    const half = CONFIG.blade.slash.angleHalf;

    // 1) 刀锋上的火星：沿扇形外缘撒，反射方向 = 径向 + 随机的切向偏移
    const sparks = 20 + Math.min(14, hits * 3);
    for (let i = 0; i < sparks; i++) {
      const a = angle + rand(-half * 0.94, half * 0.94);
      const rad = range * rand(0.4, 1.02);
      const s = rand(150, 380) * power;
      const nx = Math.cos(a);
      const ny = Math.sin(a);
      const tx = -ny;
      const ty = nx;
      const side = rand(-0.75, 0.75);
      pushParticle({
        x: cx + nx * rad,
        y: cy + ny * rad,
        vx: (nx + tx * side) * s,
        vy: (ny + ty * side) * s,
        life: rand(0.14, 0.34),
        drag: 0.88,
        color: i % 4 === 0 ? '#ffffff' : '#cdf6ff'
      });
    }

    // 2) 三条弧形刀光：从扇形一边扫到另一边，并逐渐向朝向收拢
    for (let k = 0; k < 3; k++) {
      const f0 = 0.06 + k * 0.14;
      pushParticle({
        x: cx, y: cy,
        life: 0.2 + k * 0.035,
        drag: 1,
        color: k === 0 ? '#ffffff' : '#9fe8ff',
        trail: { len: 26 - k * 6, w: 3.4 - k * 0.8 },
        arc: { angle: angle, rad: range * (0.72 + k * 0.11), angleStart: angle - half, f0: f0 }
      });
    }

    // 3) 抽刀本身的短促冲击拖尾（朝鼠标方向）
    for (let i = 0; i < 6; i++) {
      const a = angle + rand(-0.3, 0.3);
      const nx = Math.cos(a);
      const ny = Math.sin(a);
      pushParticle({
        x: cx + nx * rand(8, 26), y: cy + ny * rand(8, 26),
        vx: nx * rand(210, 330),
        vy: ny * rand(210, 330),
        life: rand(0.1, 0.2),
        drag: 0.87,
        color: '#eaffff',
        trail: { len: rand(8, 14), w: 2.2 }
      });
    }
  }

  /** 命中敌人的位置溅一道短刀痕，强化"砍到了"的反馈 */
  function spawnHitSparks(x, y, angle, count) {
    const per = perpOf(Math.cos(angle), Math.sin(angle));
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const s = rand(140, 330);
      pushParticle({
        x: x, y: y,
        vx: Math.cos(angle) * rand(40, 130) + per.x * side * s,
        vy: Math.sin(angle) * rand(40, 130) + per.y * side * s,
        life: rand(0.12, 0.26),
        color: i % 3 === 0 ? '#ffffff' : '#bff3ff'
      });
    }
    pushParticle({
      x: x, y: y, life: rand(0.1, 0.16), drag: 0.9,
      vx: Math.cos(angle) * 150, vy: Math.sin(angle) * 150,
      color: '#ffffff', trail: { len: 16, w: 2.6 }
    });
  }

  /** 半圆斩击特效的衰减 */
  function updateSlashFx(dt) {
    for (let i = slashFx.length - 1; i >= 0; i--) {
      const s = slashFx[i];
      s.life -= dt;
      if (s.life <= 0) slashFx.splice(i, 1);
    }
  }

  /**
   * 远程敌人开火：朝"玩家当前位置（+一点提前量）"发射一颗子弹。
   * 子弹是**朝开火那一刻的玩家位置**直线飞的，之后不会再追踪，
   * 所以左右走位就能躲开（这也是远程怪的主要应对方式）。
   */
  function fireHostileBullet(e) {
    const cfg = CONFIG.enemy.ranged;

    let dx = player.x - e.x;
    let dy = player.y - e.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;

    // 提前量：按玩家当前的横向移动趋势（与"怪->玩家"连线的叉积方向）加一点偏移
    if (cfg.aimLead > 0) {
      const move = playerMoveDir();
      if (move.x !== 0 || move.y !== 0) {
        const cross = dx * move.y - dy * move.x;
        const lead = Math.max(-1, Math.min(1, -cross)) * cfg.aimLead;
        const ang = Math.atan2(dy, dx) + lead;
        dx = Math.cos(ang);
        dy = Math.sin(ang);
      }
    }

    const muzzle = e.size * 0.5 + 4;
    bullets.push({
      x: e.x + dx * muzzle,
      y: e.y + dy * muzzle,
      px: e.x + dx * muzzle,
      py: e.y + dy * muzzle,
      vx: dx * cfg.bulletSpeed,
      vy: dy * cfg.bulletSpeed,
      radius: cfg.bulletRadius,
      color: cfg.bulletColor,
      damage: cfg.bulletDamage,
      hostile: true,
      traveled: 0,
      range: cfg.bulletRange
    });

    // 开火瞬间的小闪光，让"它要打我了"看得见
    burst(e.x + dx * muzzle, e.y + dy * muzzle, cfg.bulletColor, 4, 130);
    e.bullets++;
  }

  /** 玩家当前的移动方向（按住的方向键），用于远程怪的提前量估算 */
  function playerMoveDir() {
    let dx = 0;
    let dy = 0;
    if (keys['KeyA'] || keys['ArrowLeft']) dx -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) dx += 1;
    if (keys['KeyW'] || keys['ArrowUp']) dy -= 1;
    if (keys['KeyS'] || keys['ArrowDown']) dy += 1;
    if (dx !== 0 && dy !== 0) {
      const inv = 1 / Math.sqrt(2);
      dx *= inv;
      dy *= inv;
    }
    return { x: dx, y: dy };
  }

  function updateEnemies(dt) {
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];

      const dx = player.x - e.x;
      const dy = player.y - e.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = dx / len;
      const ny = dy / len;

      const half = e.size / 2;
      const px = e.x;      // 记录移动前的位置：用来判断有没有被石头卡住
      const py = e.y;

      // ---------- 移动 ----------
      if (e.activeDist > 0) {
        // 远程敌人（紫色）：
        //   len > resumeDist  -> 主动追着玩家跑（刚出生时离得远，就是在追人）
        //   len <= resumeDist -> 已经进过场内，一直等到玩家跑出 resumeDist 才重新起步
        // activeDist(停下开火) < resumeDist(继续追) 构成滞回，避免在边界反复起步/刹车。
        const chasing = e._closing ? len > e.resumeDist : len > e.activeDist;

        if (chasing) {
          // 分轴推进：撞到石头会沿墙面滑动，而不是原地顶着
          e.x += nx * e.speed * dt;
          settleActor(e, half);
          e.y += ny * e.speed * dt;
          settleActor(e, half);
        }
        e._closing = chasing;

        // 只有"到位停住、不再追人"的时候才开火 -> 不会一出现就隔着半个屏幕放枪
        // 另外：玩家躲到岩石后面（视线被挡住）时也不开火 —— 这就是"卡视野"
        if (e.hostile && !chasing) {
          e.fireCd -= dt;
          if (e.fireCd <= 0) {
            e.fireCd += CONFIG.enemy.ranged.fireInterval;
            if (e.fireCd <= 0) e.fireCd = CONFIG.enemy.ranged.fireInterval;
            if (!game.over && !rockBlocksLine(e.x, e.y, player.x, player.y, 2)) {
              fireHostileBullet(e);
            }
          }
        } else if (e.hostile && e.fireCd < CONFIG.enemy.ranged.fireDelay) {
          // 追击途中把第一发的延迟垫着，保证停下来之后还有一点反应时间
          e.fireCd = Math.min(CONFIG.enemy.ranged.fireDelay,
            e.fireCd + dt * 0.5);
        }
      } else {
        // 近战敌人：一直追（同样分轴推进，碰到石头贴着滑过去）
        e.x += nx * e.speed * dt;
        settleActor(e, half);
        e.y += ny * e.speed * dt;
        settleActor(e, half);
      }

      // 收尾：别让任何怪停在石头里 / 被推出世界外
      settleActor(e, half);

      // 被石头卡住时侧向绕行：贴着墙面走一小段，避免永远顶在石头正中间
      const moved2 = dist2(e.x, e.y, px, py);
      if (moved2 < (e.speed * dt * 0.25) * (e.speed * dt * 0.25)) {
        e.stuckT = (e.stuckT || 0) + dt;
        if (e.stuckT > 0.35) {
          e.stuckT = 0;
          e.rockSlide = Math.random() < 0.5 ? 1 : -1;   // 随机挑一侧绕
        }
      } else {
        e.stuckT = 0;
      }

      if (e.rockSlide) {
        // 沿"指向玩家的方向的垂直方向"侧移，绕开石头后自然回到追击路线
        const sx = -ny * e.rockSlide;
        const sy = nx * e.rockSlide;
        const preX = e.x;
        const preY = e.y;
        e.x += sx * e.speed * dt;
        settleActor(e, half);
        e.y += sy * e.speed * dt;
        settleActor(e, half);
        // 绕出效果已经产生（或绕了一会儿）就恢复正常追击
        e.slideT = (e.slideT || 0) + dt;
        if (dist2(e.x, e.y, preX, preY) < 0.01 || e.slideT > 1.2) {
          e.rockSlide = 0;
          e.slideT = 0;
        }
      }

      if (e.flash > 0) e.flash = Math.max(0, e.flash - dt);
      if (e.dashHit && player.dashTime <= 0) e.dashHit = false;

      // ---------- 碰到玩家 ----------
      if (e.contact !== false &&
          circleRectHit(e.x, e.y, e.size * 0.5, player.x, player.y, player.size)) {
        hurtPlayer(e.damage);
        // 撞完把自己推开一点，避免一直贴着（远程怪 contact=false，走不到这里）
        const back = e.pushDist > 0 ? e.pushDist : 18;
        const preX = e.x;
        const preY = e.y;
        e.x -= nx * back;
        e.y -= ny * back;
        settleActor(e, half);
        // 如果把自己往玩家方向推回来等于没推动（比如被岩石顶住），
        // 就改成从"重叠最少"的那条轴弹开，避免和玩家原地贴脸互推。
        if (dist2(e.x, e.y, preX, preY) < 0.25) {
          const sum = e.size * 0.5 + player.size * 0.5;
          const ox = e.x - player.x;
          const oy = e.y - player.y;
          if (Math.abs(ox) >= Math.abs(oy)) {
            e.x = player.x + (ox >= 0 ? 1 : -1) * (sum + back);
          } else {
            e.y = player.y + (oy >= 0 ? 1 : -1) * (sum + back);
          }
          settleActor(e, half);
        }
      }
    }
  }

  /** 子弹与"敌人当前所在圆"的碰撞（敌人按方块碰撞体积换算成内切圆） */
  function bulletHitsEnemy(x, y, r, e) {
    const er = e.size * 0.5 + r;
    return dist2(x, y, e.x, e.y) <= er * er;
  }

  /**
   * 线段（子弹上一帧位置 -> 当前位置）与圆的碰撞。
   * 弹速最高 640 像素/秒，低帧率下单帧位移可能超过小怪的直径，
   * 只做"点判定"会出现穿模（子弹从快速小怪身上穿过去）。
   * 这里按线段最近距离判定，彻底避免穿模。
   */
  function bulletHitCircle(x0, y0, x1, y1, cx, cy, r) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    let t = 0;
    if (len2 > 0.000001) {
      t = ((cx - x0) * dx + (cy - y0) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
    }
    const px = x0 + dx * t;
    const py = y0 + dy * t;
    return dist2(px, py, cx, cy) <= r * r;
  }

  function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];

      // 记下上一帧位置，用于线段碰撞判定
      b.px = b.x;
      b.py = b.y;

      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.traveled += Math.hypot(b.vx, b.vy) * dt;

      const range = b.range || CONFIG.bullet.range;

      // 超射程 / 出界
      // 出界判定贴着地图边界（不再外扩 50 像素），子弹不会飞到地图外面去
      if (b.traveled > range ||
          b.x < 0 || b.x > CONFIG.world.width ||
          b.y < 0 || b.y > CONFIG.world.height) {
        bullets.splice(i, 1);
        continue;
      }

      // ---------- 岩石掩体：挡子弹（玩家子弹和敌方弹幕一视同仁）----------
      // 用"上一帧 -> 这一帧"的线段求交，弹速再快也不会从石头里穿过去。
      const rockHit = bulletRockHit(b.px, b.py, b.x, b.y, b.radius);
      if (rockHit) {
        bullets.splice(i, 1);
        // 打在石头上的碎屑：体现"这里能挡弹幕"
        burst(rockHit.x, rockHit.y, '#8d949e', 4, 140);
        continue;
      }

      // ---------- 敌方子弹：只打玩家，不会误伤敌人，也不给玩家充能 ----------
      if (b.hostile) {
        const hitR = player.size * 0.5 + b.radius;
        if (bulletHitCircle(b.px, b.py, b.x, b.y, player.x, player.y, hitR)) {
          bullets.splice(i, 1);
          burst(b.x, b.y, b.color || '#c98bff', 6, 190);
          hurtPlayer(b.damage);
        }
        continue;
      }

      // ---------- 玩家子弹：一颗子弹只打一个敌人 ----------
      let hit = null;
      for (let j = 0; j < enemies.length; j++) {
        const e = enemies[j];
        if (bulletHitCircle(b.px, b.py, b.x, b.y, e.x, e.y, e.size * 0.5 + b.radius)) {
          hit = e;
          break;
        }
      }

      // 没有小怪挡在前面就判 Boss（方块按外接半径算，打上去很"实"）
      if (!hit && boss) {
        const br = boss.size * 0.5 + b.radius;
        if (bulletHitCircle(b.px, b.py, b.x, b.y, boss.x, boss.y, br)) {
          bullets.splice(i, 1);
          burst(b.x, b.y, CONFIG.bullet.color, 5, 180);
          playSfx('hit');
          gainEnergy(CONFIG.blade.energyPerHit);
          // 打 Boss 的反馈视觉更强一点
          spawnHitSparks(b.x, b.y, Math.atan2(b.vy, b.vx), 3);
          damageBoss(b.damage);
          continue;
        }
      }

      if (hit) {
        bullets.splice(i, 1);
        hit.hp -= b.damage;
        hit.flash = 0.12;
        burst(b.x, b.y, CONFIG.bullet.color, 5, 180);

        // 命中音效（内部有 80ms 节流，怪多时不会叠成噪音）
        playSfx('hit');

        // 大招充能：命中 +1%（拔刀状态的 8 秒内不回能）
        gainEnergy(CONFIG.blade.energyPerHit);

        if (hit.hp <= 0) killEnemy(hit);
      }
    }
  }

  function killEnemy(e) {
    const idx = enemies.indexOf(e);
    if (idx !== -1) enemies.splice(idx, 1);

    // 玩家的总击杀数：只用于 UI 显示和数值成长，任何时候都不清空
    game.kills++;

    // ★ Boss 进度：每击杀一个敌人 +1（Boss 在场 / 清场安全期不加，见 addBossProgress）
    addBossProgress(CONFIG.boss.progressPerKill);

    burst(e.x, e.y, e.color || CONFIG.enemy.color, 12, 300);
    playSfx('kill');

    // ---- 源氏核心玩法 ----
    resetDash();                               // 击杀立刻重置 Shift 冲刺冷却
    // 大招充能：击杀 +5%（拔刀状态的 8 秒内不回能，见 canGainEnergy）
    gainEnergy(CONFIG.blade.energyPerKill);

    // 掉落经验球
    // 拔刀状态（大招 8 秒内）不掉经验球：
    //  1) 与"拔刀期间不积攒任何资源"的规则一致
    //  2) 避免一次清场掉一地经验球，瞬间连升多级弹出升级面板，
    //     把正在进行的 8 秒大招硬生生冻住
    if (player.blade > 0) return;

    orbs.push({
      x: e.x + rand(-6, 6),
      y: e.y + rand(-6, 6),
      radius: CONFIG.orb.radius,
      life: 0
    });
  }

  function updateOrbs(dt) {
    for (let i = orbs.length - 1; i >= 0; i--) {
      const o = orbs[i];
      o.life += dt;

      const dx = player.x - o.x;
      const dy = player.y - o.y;
      const len = Math.hypot(dx, dy) || 1;

      // 缓慢飘向玩家，手感更好（拾取范围升级后会吸得更远更快）
      if (len > 8) {
        o.x += (dx / len) * player.attractSpeed * dt;
        o.y += (dy / len) * player.attractSpeed * dt;
      }

      // 拾取 -> 增加经验，可能触发升级
      if (len <= player.pickupDist) {
        orbs.splice(i, 1);
        burst(o.x, o.y, CONFIG.orb.color, 4, 120);
        playSfx('exp');
        gainXp(XP.perOrb);
        continue;
      }

      if (o.life > CONFIG.orb.expireTime) orbs.splice(i, 1);
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];

      // 弧形刀光：从扇形一边扫向朝向，半径同时向内收
      if (p.arc) {
        p.arc.f0 += dt / p.maxLife;
        const spread = CONFIG.blade.slash.angleHalf * (1 - Math.min(1, p.arc.f0) * 0.72);
        p.x = player.x + Math.cos(p.arc.angle - spread) * p.arc.rad;
        p.y = player.y + Math.sin(p.arc.angle - spread) * p.arc.rad;
        p.life -= dt;
        if (p.life <= 0) particles.splice(i, 1);
        continue;
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function updateCamera() {
    let cx = player.x - viewWidth / 2;
    let cy = player.y - viewHeight / 2;

    // 摄像机跟着玩家，但永远不越出 5000×5000 的地图：
    // 走到地图边缘时视野会顶在边界上（画面里不会出现地图外的黑边）。
    // 视口比地图还大时（极少见）就把地图居中。
    if (CONFIG.world.width <= viewWidth) {
      cx = (CONFIG.world.width - viewWidth) / 2;
    } else {
      cx = Math.max(0, Math.min(CONFIG.world.width - viewWidth, cx));
    }

    if (CONFIG.world.height <= viewHeight) {
      cy = (CONFIG.world.height - viewHeight) / 2;
    } else {
      cy = Math.max(0, Math.min(CONFIG.world.height - viewHeight, cy));
    }

    camera.x = cx;
    camera.y = cy;
  }

  function update(dt) {
    // 暂停或正在选升级：彻底冻结游戏时间、敌人、子弹、经验球和特效
    if (game.paused || game.choosing) return;

    if (game.shake > 0) game.shake = Math.max(0, game.shake - dt);

    if (game.over) {
      updateParticles(dt);
      updateCamera();
      return;
    }

    game.time += dt;

    updateRaid(dt);        // Boss 触发判定 / 清场倒计时 / 横幅计时

    updatePlayer(dt);
    updateEnemies(dt);
    updateBoss(dt);        // Boss 本体（没有 Boss 时内部立刻返回）
    updateBullets(dt);
    updateOrbs(dt);
    updateParticles(dt);
    updateAfterimages(dt);
    updateSlashFx(dt);
    updateShockRings(dt);

    // 刷怪：用 while 消耗计时器，避免低帧率下漏刷
    // Boss 战期间（phase === 'boss'）完全不刷新普通小怪；清场观望期也不刷
    spawnTimer += dt;
    if (raid.phase === 'idle') {
      while (spawnTimer >= CONFIG.enemy.spawnInterval) {
        spawnTimer -= CONFIG.enemy.spawnInterval;
        spawnWave();
      }
    } else if (spawnTimer > CONFIG.enemy.spawnInterval * 4) {
      spawnTimer = 0;     // 别让计时器攒到 Boss 战结束后一次性爆出来
    }

    // 自动射击（拔刀状态下间隔减半 -> 攻速翻倍）
    const fireInterval = effectiveFireInterval();
    fireTimer += dt;
    while (fireTimer >= fireInterval) {
      fireTimer -= fireInterval;
      fireBullet();
    }

    updateCamera();
  }

  // ------------------------------------------------------------
  //  绘制
  // ------------------------------------------------------------
  function drawGrid() {
    const left = camera.x;
    const top = camera.y;
    const right = camera.x + viewWidth;
    const bottom = camera.y + viewHeight;

    ctx.strokeStyle = '#1b2130';
    ctx.lineWidth = 1;
    ctx.beginPath();

    const startX = Math.floor(left / CONFIG.grid) * CONFIG.grid;
    for (let x = startX; x <= right; x += CONFIG.grid) {
      const sx = Math.round(x - left) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, viewHeight);
    }

    const startY = Math.floor(top / CONFIG.grid) * CONFIG.grid;
    for (let y = startY; y <= bottom; y += CONFIG.grid) {
      const sy = Math.round(y - top) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(viewWidth, sy);
    }

    ctx.stroke();
  }

  /**
   * 环境掩体：深灰色岩石。
   * 画在网格之上、所有角色之下 —— 石头是"地形"，角色和子弹都压在它上面。
   * 用圆心（屏幕中心）做一次粗筛，屏幕外的石头直接跳过（40 块石头开销可以忽略）。
   */
  function drawRocks() {
    const cfg = CONFIG.rock;
    const cullR = Math.hypot(viewWidth, viewHeight) / 2 + cfg.sizeMax;
    const visible = rockIndicesNear(camera.x + viewWidth / 2, camera.y + viewHeight / 2, cullR);

    // 只取视口附近的石头（40 块左右全画也不慢，但没必要）
    if (!visible) return;

    for (let i = 0; i < visible.length; i++) {
      const rk = rocks[visible[i]];
      const sx = rk.x - camera.x;
      const sy = rk.y - camera.y;

      if (sx + rk.hw < -40 || sx - rk.hw > viewWidth + 40 ||
          sy + rk.hh < -40 || sy - rk.hh > viewHeight + 40) continue;

      const left = Math.round(sx - rk.hw);
      const top = Math.round(sy - rk.hh);
      const w = Math.max(2, Math.round(rk.hw * 2));
      const h = Math.max(2, Math.round(rk.hh * 2));

      // 主体（深灰）+ 描边
      ctx.fillStyle = cfg.color;
      ctx.fillRect(left, top, w, h);
      ctx.strokeStyle = cfg.edgeColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(left + 1, top + 1, w - 2, h - 2);

      // 顶面亮边：给一点体积感，不至于是一块死板的灰方块
      ctx.fillStyle = cfg.topColor;
      ctx.fillRect(left + 2, top + 2, w - 4, Math.max(2, Math.round(h * 0.16)));

      // 表面碎石斑点（位置由 seed 决定，逐帧稳定不闪烁）
      const speckCount = 3 + Math.floor((rk.seed % 4));
      ctx.fillStyle = cfg.speckColor;
      for (let k = 0; k < speckCount; k++) {
        const a = Math.sin(rk.seed * 12.9898 + k * 78.233) * 43758.5453;
        const b = Math.sin(rk.seed * 39.3468 + k * 11.135) * 24634.6345;
        const fx = left + 6 + Math.abs(a % 1) * Math.max(1, w - 16);
        const fy = top + 8 + Math.abs(b % 1) * Math.max(1, h - 18);
        const fs = 3 + Math.abs((a + b) % 1) * 5;
        ctx.fillRect(Math.round(fx), Math.round(fy), Math.round(fs), Math.round(fs * 0.7));
      }
    }
  }

  function drawWorldBorder() {
    ctx.strokeStyle = '#2a3550';
    ctx.lineWidth = 4;
    ctx.strokeRect(-camera.x, -camera.y, CONFIG.world.width, CONFIG.world.height);
  }

  function drawOrbs() {
    for (let i = 0; i < orbs.length; i++) {
      const o = orbs[i];
      const sx = o.x - camera.x;
      const sy = o.y - camera.y;
      if (sx < -20 || sx > viewWidth + 20 || sy < -20 || sy > viewHeight + 20) continue;

      ctx.fillStyle = 'rgba(87, 224, 122, 0.18)';
      ctx.beginPath();
      ctx.arc(sx, sy, o.radius * 2.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = CONFIG.orb.color;
      ctx.beginPath();
      ctx.arc(sx, sy, o.radius, 0, Math.PI * 2);
      ctx.fill();

      // 高光
      ctx.fillStyle = '#d6ffe2';
      ctx.beginPath();
      ctx.arc(sx - 1.5, sy - 1.5, o.radius * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * 拔刀状态的半圆特效：
   * 以玩家为圆心、朝向鼠标方向的半透明半圆。
   * 半径由 bladeRadius() 决定 -> 随"子弹数量增益"（多重射击）放大。
   */
  function drawBladeCone() {
    if (player.blade <= 0) return;

    const cx = player.x - camera.x;
    const cy = player.y - camera.y;
    const radius = bladeRadius();
    const angle = Math.atan2(player.facing.y, player.facing.x);
    const start = angle - CONFIG.blade.angleHalf;
    const end = angle + CONFIG.blade.angleHalf;

    const remain = Math.min(1, player.blade / CONFIG.blade.duration);
    const pulse = 0.82 + 0.18 * Math.sin(game.time * 12);   // 呼吸/脉动

    ctx.save();

    // 半圆主体：中心浓、边缘淡的径向渐变
    const grad = ctx.createRadialGradient(cx, cy, radius * 0.12, cx, cy, radius);
    grad.addColorStop(0, 'rgba(150, 240, 255, ' + (0.30 * pulse).toFixed(3) + ')');
    grad.addColorStop(0.55, 'rgba(90, 200, 255, ' + (0.20 * pulse).toFixed(3) + ')');
    grad.addColorStop(1, 'rgba(60, 150, 255, 0)');

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // 两条半径边线
    ctx.strokeStyle = 'rgba(180, 245, 255, ' + (0.35 * remain + 0.15).toFixed(3) + ')';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(start) * radius, cy + Math.sin(start) * radius);
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(end) * radius, cy + Math.sin(end) * radius);
    ctx.stroke();

    // 外缘弧线：更亮，标出"攻击范围"
    ctx.strokeStyle = 'rgba(200, 250, 255, ' + (0.55 * remain + 0.2).toFixed(3) + ')';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, end);
    ctx.stroke();

    // 内圈扫描光
    ctx.strokeStyle = 'rgba(255, 255, 255, ' + (0.22 * remain).toFixed(3) + ')';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.72, start, end);
    ctx.stroke();

    ctx.restore();
  }

  /** 释放瞬间划出的半圆斩击 / 左键扇形挥砍（快速淡出） */
  function drawSlashFx() {
    for (let i = 0; i < slashFx.length; i++) {
      const s = slashFx[i];
      const t = Math.max(0, s.life / s.maxLife);
      const cx = s.x - camera.x;
      const cy = s.y - camera.y;
      const melee = s.style === 'melee';
      const half = (melee ? CONFIG.blade.slash.angleHalf : CONFIG.blade.angleHalf);
      const start = s.angle - half;
      const end = s.angle + half;

      if (melee) {
        drawMeleeSlash(s, cx, cy, t, start, end);
        continue;
      }

      // 大招：稍微向内收，像刀光扫过
      const r = s.radius * (1.05 - 0.28 * t);
      ctx.save();
      const grad = ctx.createRadialGradient(cx, cy, r * 0.35, cx, cy, r);
      grad.addColorStop(0, 'rgba(255, 255, 255, ' + (0.34 * t).toFixed(3) + ')');
      grad.addColorStop(1, 'rgba(160, 235, 255, 0)');
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, end);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.strokeStyle = 'rgba(240, 255, 255, ' + (0.9 * t).toFixed(3) + ')';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(cx, cy, r, start, end);
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * 左键挥砍的视觉：淡蓝色扇形残影 + 向外扩张的亮弧 + 命中的冲击弧。
   * 命中越多，残影越亮（打击感反馈）。
   */
  /**
   * 左键挥砍的视觉。
   * 半径 R = bladeRadius()，与真实伤害判定区域**完全一致**，并随鼠标方向旋转：
   * 因为玩家在拔刀状态下 facing 每帧跟随鼠标（见 updatePlayer），
   * 而这里用的 angle 就是挥砍那一刻的鼠标方向。
   * 角宽同样取 CONFIG.blade.slash.angleHalf（左右各 90°），
   * 所以"画出来的半圆内所有敌人"就是"吃到挥砍伤害的敌人"。
   */
  function drawMeleeSlash(s, cx, cy, t, start, end) {
    const R = s.radius;
    const ease = 1 - t;                                   // 0 -> 1 的推进量
    const hits = s.hits || 0;
    const power = Math.min(1, 0.45 + hits * 0.2);          // 命中越多越亮

    ctx.save();

    // 1) 淡蓝色扇形残影：跟随鼠标方向，随时间向外扩散并淡出
    //    范围随子弹数量增益变大 -> 亮度按范围略微收敛，避免大范围时糊成一片
    const spread = Math.max(0.45, 190 / R);
    const inner = R * (0.18 + 0.34 * ease);
    const outer = R * (0.80 + 0.25 * ease);
    const grad = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
    grad.addColorStop(0, 'rgba(120, 210, 255, 0)');
    grad.addColorStop(0.45, 'rgba(150, 228, 255, ' + (0.30 * t * power * spread).toFixed(3) + ')');
    grad.addColorStop(1, 'rgba(200, 245, 255, ' + (0.42 * t * power * spread).toFixed(3) + ')');
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, outer, start, end);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // 2) 外缘亮弧：向外扫出去
    const sweepR = R * (0.72 + 0.34 * ease);
    ctx.strokeStyle = 'rgba(215, 248, 255, ' + (0.85 * t).toFixed(3) + ')';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(cx, cy, sweepR, start, end);
    ctx.stroke();

    // 3) 两条扇形边线
    ctx.strokeStyle = 'rgba(160, 230, 255, ' + (0.45 * t).toFixed(3) + ')';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(start) * sweepR, cy + Math.sin(start) * sweepR);
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(end) * sweepR, cy + Math.sin(end) * sweepR);
    ctx.stroke();

    // 4) 命中反馈：以玩家为中心的一圈白光（表示吸血/命中）
    if (hits > 0) {
      ctx.strokeStyle = 'rgba(190, 255, 220, ' + (0.55 * t).toFixed(3) + ')';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 16 + 12 * ease, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  /** 冲刺残影：沿冲刺方向拉长的锐利菱形（比原来的方块更像刀锋拖影） */
  function drawAfterimages() {
    for (let i = 0; i < afterimages.length; i++) {
      const a = afterimages[i];
      const t = Math.max(0, a.life / a.maxLife);
      const cx = a.x - camera.x;
      const cy = a.y - camera.y;
      const w = a.w === undefined ? a.size : a.w;
      const h = a.h === undefined ? a.size : a.h;
      const angle = a.angle === undefined ? 0 : a.angle;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.globalAlpha = 0.46 * t;
      ctx.fillStyle = '#8ef0ff';
      ctx.beginPath();
      ctx.moveTo(0, -h * 0.5);
      ctx.lineTo(w * 0.42, 0);
      ctx.lineTo(0, h * 0.5);
      ctx.lineTo(-w * 0.42, 0);
      ctx.closePath();
      ctx.fill();
      // 中心一道更亮的窄条，强化"速度"感
      ctx.globalAlpha = 0.34 * t;
      ctx.fillStyle = '#eaffff';
      ctx.fillRect(-w * 0.09, -h * 0.46, w * 0.18, h * 0.92);
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  /**
   * 敌人绘制：三种怪共用一套画法，靠 e.kind 换形状，一眼能分辨：
   *   normal 红色方块 · fast 黄色小三角（更小更快） · ranged 紫色菱形 + 开火冷却环
   * 尺寸、颜色、血量条都取自敌人自身字段，所以小怪画出来就是小的。
   */
  function drawEnemies() {
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const ex = e.x - camera.x;
      const ey = e.y - camera.y;
      const sx = e.x - e.size / 2 - camera.x;
      const sy = e.y - e.size / 2 - camera.y;
      const pad = e.size + 40;
      if (sx < -pad || sx > viewWidth + pad || sy < -pad || sy > viewHeight + pad) continue;

      const kind = e.kind || 'normal';
      const body = e.flash > 0 ? '#ffffff' : (e.color || CONFIG.enemy.color);

      ctx.save();
      ctx.translate(ex, ey);

      // 地面投影
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      if (kind === 'fast') {
        ctx.beginPath();
        ctx.arc(3, 3, e.size * 0.55, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-e.size / 2 + 3, -e.size / 2 + 3, e.size, e.size);
      }

      ctx.fillStyle = body;

      if (kind === 'fast') {
        // 黄色：朝玩家的小三角，比普通怪明显小一圈
        const ang = Math.atan2(player.y - e.y, player.x - e.x);
        ctx.rotate(ang);
        const r = e.size * 0.62;
        ctx.beginPath();
        ctx.moveTo(r, 0);
        ctx.lineTo(-r * 0.75, r * 0.78);
        ctx.lineTo(-r * 0.75, -r * 0.78);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 245, 190, 0.9)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else if (kind === 'ranged') {
        // 紫色：菱形（和"远程/施法"的观感一致）
        const r = e.size * 0.62;
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(r, 0);
        ctx.lineTo(0, r);
        ctx.lineTo(-r, 0);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(226, 200, 255, 0.9)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // 中心的蓄力点：越接近下次开火越亮 -> 玩家能预判"要开枪了"
        const cfg = CONFIG.enemy.ranged;
        const charge = 1 - Math.max(0, Math.min(1, e.fireCd / cfg.fireInterval));
        ctx.fillStyle = 'rgba(255, 255, 255, ' + (0.25 + 0.7 * charge).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(0, 0, 1.6 + 2.6 * charge, 0, Math.PI * 2);
        ctx.fill();

        // 开火冷却环（从 12 点方向顺时针读完就是下一次开枪）
        ctx.strokeStyle = 'rgba(201, 139, 255, 0.55)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, e.size * 0.92 + 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * charge);
        ctx.stroke();
      } else {
        // 普通红色方块
        ctx.fillRect(-e.size / 2, -e.size / 2, e.size, e.size);
      }

      ctx.restore();

      // 朝玩家看的小眼睛
      const ang = Math.atan2(player.y - e.y, player.x - e.x);
      ctx.fillStyle = 'rgba(20, 8, 10, 0.85)';
      ctx.beginPath();
      ctx.arc(ex + Math.cos(ang) * e.size * 0.2, ey + Math.sin(ang) * e.size * 0.2,
        Math.max(1.4, e.size * 0.1), 0, Math.PI * 2);
      ctx.fill();

      // 掉过血才显示血条
      if (e.hp < e.maxHp) {
        const ratio = Math.max(0, e.hp / e.maxHp);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(sx, sy - 8, e.size, 4);
        ctx.fillStyle = kind === 'fast' ? '#ffd93d' : (kind === 'ranged' ? '#c98bff' : '#ff6b6b');
        ctx.fillRect(sx, sy - 8, e.size * ratio, 4);
      }
    }
  }

  /**
   * Boss 本体：一个巨大的暗红色方块。
   * 画法刻意比小怪"厚"：地面投影 + 三层嵌套方框 + 呼吸脉动 + 核心红点 +
   * 弹幕蓄力时的红色警示描边，让玩家一眼看出"这玩意儿很大很危险"。
   */
  function drawBoss() {
    if (!boss) return;

    const cfg = CONFIG.boss;
    const cx = boss.x - camera.x;
    const cy = boss.y - camera.y;
    const half = boss.size / 2;
    const pulse = 0.5 + 0.5 * Math.sin(game.time * 4.5);

    // 蓄力预警：快放弹幕时整块变红
    const charging = boss.pendingWaves > 0 ||
      (boss.barrageCd <= cfg.telegraph && boss.barrageCd > 0);
    const bright = boss.flash > 0;

    ctx.save();

    // 地面投影（很大一块，突出体积感）
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(cx - half + 14, cy - half + 16, boss.size, boss.size);

    // 外圈光晕
    const glow = ctx.createRadialGradient(cx, cy, half * 0.5, cx, cy, half * 2.1);
    glow.addColorStop(0, 'rgba(220, 40, 50, ' + (0.22 + 0.16 * pulse).toFixed(3) + ')');
    glow.addColorStop(1, 'rgba(180, 20, 30, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, half * 2.1, 0, Math.PI * 2);
    ctx.fill();

    // 本体（三层嵌套：外壳 / 中层 / 核心）
    const bodyOuter = bright ? '#ffdede' : cfg.color;
    const bodyInner = bright ? '#ffffff' : (charging ? cfg.coreColor : cfg.edgeColor);

    ctx.fillStyle = bodyOuter;
    ctx.fillRect(cx - half, cy - half, boss.size, boss.size);

    const inset = boss.size * 0.13;
    ctx.fillStyle = 'rgba(70, 8, 14, 0.85)';
    ctx.fillRect(cx - half + inset, cy - half + inset,
      boss.size - inset * 2, boss.size - inset * 2);

    const inset2 = boss.size * 0.26;
    ctx.fillStyle = bodyInner;
    ctx.beginPath();
    ctx.rect(cx - half + inset2, cy - half + inset2,
      boss.size - inset2 * 2, boss.size - inset2 * 2);
    ctx.fill();

    // 核心：一颗随脉动缩放的红点
    const coreR = boss.size * (0.10 + 0.035 * pulse);
    ctx.fillStyle = bright ? '#ffffff' : '#ffd0d0';
    ctx.beginPath();
    ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
    ctx.fill();

    // 边框：蓄力时变亮并加粗，是很明确的"要放弹幕了"提示
    ctx.strokeStyle = charging
      ? 'rgba(255, 90, 90, ' + (0.6 + 0.4 * pulse).toFixed(3) + ')'
      : 'rgba(255, 190, 190, 0.7)';
    ctx.lineWidth = charging ? 5 : 3;
    ctx.strokeRect(cx - half, cy - half, boss.size, boss.size);

    // 朝向玩家的"眼睛"（一小条更亮的方块，暗示它在盯着你）
    const ang = Math.atan2(player.y - boss.y, player.x - boss.x);
    ctx.fillStyle = 'rgba(255, 240, 240, 0.85)';
    ctx.beginPath();
    ctx.arc(cx + Math.cos(ang) * boss.size * 0.3,
            cy + Math.sin(ang) * boss.size * 0.3,
            boss.size * 0.07, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /** 弹幕的预警 / 冲击圆环（地面上的一圈红光，垫在角色下面画） */
  function drawShockRings() {
    for (let i = 0; i < shockRings.length; i++) {
      const r = shockRings[i];
      const t = Math.max(0, r.life / r.maxLife);
      const sx = r.x - camera.x;
      const sy = r.y - camera.y;
      if (sx < -r.r - 40 || sx > viewWidth + r.r + 40 ||
          sy < -r.r - 40 || sy > viewHeight + r.r + 40) continue;

      ctx.save();
      ctx.globalAlpha = 0.15 + 0.65 * t;
      ctx.strokeStyle = r.color || CONFIG.boss.edgeColor;
      ctx.lineWidth = (r.width || 4) * (0.5 + 0.5 * t);
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(1, r.r), 0, Math.PI * 2);
      ctx.stroke();

      // 预警环内部再补一层很淡的红，增强"危险区域"的感觉
      if (r.shrink) {
        ctx.globalAlpha = 0.10 * t;
        ctx.fillStyle = r.color || CONFIG.boss.coreColor;
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawBullets() {
    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i];
      const sx = b.x - camera.x;
      const sy = b.y - camera.y;
      if (sx < -20 || sx > viewWidth + 20 || sy < -20 || sy > viewHeight + 20) continue;
      // 拖尾
      const len = Math.hypot(b.vx, b.vy) || 1;
      ctx.strokeStyle = b.hostile
        ? 'rgba(232, 67, 79, 0.38)'
        : 'rgba(255, 217, 61, 0.35)';
      ctx.lineWidth = b.radius * 1.6;
      ctx.beginPath();
      ctx.moveTo(sx - (b.vx / len) * 14, sy - (b.vy / len) * 14);
      ctx.lineTo(sx, sy);
      ctx.stroke();

      // Boss 弹幕：外面再套一圈暗红描边，一眼和紫色远程怪的子弹区分开
      if (b.bossBullet) {
        ctx.fillStyle = 'rgba(120, 12, 20, 0.9)';
        ctx.beginPath();
        ctx.arc(sx, sy, b.radius + 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = b.color || CONFIG.bullet.color;
      ctx.beginPath();
      ctx.arc(sx, sy, b.radius, 0, Math.PI * 2);
      ctx.fill();

      // 中心高光（子弹看起来是"实心弹丸"而不是色块）
      if (b.bossBullet) {
        ctx.fillStyle = 'rgba(255, 190, 190, 0.9)';
        ctx.beginPath();
        ctx.arc(sx - b.radius * 0.25, sy - b.radius * 0.25, b.radius * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawPlayer() {
    const cx = player.x - camera.x;
    const cy = player.y - camera.y;
    const sx = player.x - player.size / 2 - camera.x;
    const sy = player.y - player.size / 2 - camera.y;

    // 射击冷却环（随攻速升级 / 拔刀状态转得更快）
    const cooldown = Math.min(1, fireTimer / effectiveFireInterval());
    ctx.strokeStyle = player.blade > 0
      ? 'rgba(160, 240, 255, 0.75)'
      : 'rgba(255, 217, 61, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, player.size * 0.95,
      -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * cooldown);
    ctx.stroke();

    // Shift 冲刺冷却环（原来画在角色外圈的那一整圈青色圆弧）已移除：
    // 它只有 UI 提示作用却看着像"攻击范围"，容易和拔刀半圆混淆。
    // 冲刺是否就绪请看屏幕下方正中央的 Shift 技能图标（有环形读条 + 倒计时）。

    // 拔刀状态：身下一圈青色高光
    if (player.blade > 0) {
      ctx.fillStyle = 'rgba(140, 235, 255, 0.20)';
      ctx.beginPath();
      ctx.arc(cx, cy, player.size * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(sx + 3, sy + 3, player.size, player.size);

    // 无敌时间闪烁
    const blink = player.invuln > 0 && Math.floor(player.invuln * 12) % 2 === 0;
    ctx.fillStyle = player.flash > 0
      ? '#ffffff'
      : (player.healFlash > 0 ? '#7bffb0' : (blink ? '#8fb8ff' : CONFIG.player.color));
    ctx.fillRect(sx, sy, player.size, player.size);

    // 吸血时的绿色光环
    if (player.healFlash > 0) {
      ctx.strokeStyle = 'rgba(123, 255, 176, ' + (player.healFlash * 3).toFixed(3) + ')';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy, player.size * (1.1 + (0.25 - player.healFlash)), 0, Math.PI * 2);
      ctx.stroke();
    }

    // 拔刀状态描边更亮
    ctx.strokeStyle = player.blade > 0 ? '#c8f6ff' : '#9cc4ff';
    ctx.lineWidth = player.blade > 0 ? 3 : 2;
    ctx.strokeRect(sx + 1, sy + 1, player.size - 2, player.size - 2);

    // 枪口
    ctx.strokeStyle = player.blade > 0 ? '#eafcff' : '#dfe9ff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + player.facing.x * (player.size * 0.72),
               cy + player.facing.y * (player.size * 0.72));
    ctx.stroke();
  }

  /**
   * 粒子绘制：普通方块粒子 + 三种加强粒子
   *   trail   -> 沿运动方向拉出的短线拖尾（刀光/速度线）
   *   crystal -> 随机朝向的细长菱形（冲刺碎片）
   *   streak  -> 按 angle 定死方向的刀痕（渐隐但不收缩）
   */
  function drawParticles() {
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const a = Math.max(0, p.life / p.maxLife);
      const sx = p.x - camera.x;
      const sy = p.y - camera.y;

      // ---- 拖尾：沿速度方向的一条渐窄亮线 ----
      if (p.trail) {
        const sp = Math.hypot(p.vx, p.vy);
        if (sp < 1) continue;
        const len = p.trail.len;
        const nx = p.vx / sp;
        const ny = p.vy / sp;
        ctx.globalAlpha = a;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.trail.w * a + 0.4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(sx - nx * len, sy - ny * len);
        ctx.lineTo(sx, sy);
        ctx.stroke();
        continue;
      }

      // ---- 冲刺碎片 ----
      if (p.crystal) {
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(p.crystal.angle);
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        const h = p.crystal.h * (0.7 + 0.3 * a);
        const w = p.crystal.w * (0.5 + 0.5 * a);
        ctx.beginPath();
        ctx.moveTo(0, -h * 0.5);
        ctx.lineTo(w * 0.5, 0);
        ctx.lineTo(0, h * 0.5);
        ctx.lineTo(-w * 0.5, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        continue;
      }

      // ---- 刀痕：方向固定，越淡越窄 ----
      if (p.streak) {
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(p.angle);
        ctx.globalAlpha = a * 0.85;
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.length * 0.5, -p.width * 0.5 * a, p.length, Math.max(0.8, p.width * a));
        ctx.restore();
        continue;
      }

      // ---- 普通方块粒子 ----
      const s = 3 * a + 1;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.fillRect(sx - s / 2, sy - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';
  }

  function drawHud() {
    const barW = 220;
    const barH = 16;
    const bx = 14;
    const by = 14;

    // ---------- 血条 ----------
    const hpRatio = Math.max(0, player.hp / player.maxHp);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(bx - 2, by - 2, barW + 4, barH + 4);
    ctx.fillStyle = '#3a1418';
    ctx.fillRect(bx, by, barW, barH);
    ctx.fillStyle = hpRatio > 0.35 ? '#4ad66d' : '#ff5252';
    ctx.fillRect(bx, by, barW * hpRatio, barH);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, barW - 1, barH - 1);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px Consolas, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(Math.ceil(player.hp) + ' / ' + player.maxHp, bx + 8, by + barH / 2 + 1);

    // ---------- 等级 + 经验条 ----------
    const xpY = by + barH + 8;
    const xpRatio = Math.max(0, Math.min(1, game.xp / game.xpNeed));

    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(bx - 2, xpY - 2, barW + 4, barH + 4);
    ctx.fillStyle = '#1a2338';
    ctx.fillRect(bx, xpY, barW, barH);
    ctx.fillStyle = '#57e07a';
    ctx.fillRect(bx, xpY, barW * xpRatio, barH);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.strokeRect(bx + 0.5, xpY + 0.5, barW - 1, barH - 1);

    ctx.fillStyle = '#0d0f14';
    ctx.font = 'bold 12px Consolas, Menlo, monospace';
    ctx.fillText('Lv.' + game.level, bx + 8, xpY + barH / 2 + 1);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'right';
    ctx.fillText(Math.floor(game.xp) + ' / ' + game.xpNeed, bx + barW - 8, xpY + barH / 2 + 1);
    ctx.textAlign = 'left';

    // ---------- 大招能量条 + 技能图标：已移到屏幕下方正中央 ----------
    // 见 drawAbilities()，在 render() 的 HUD 之后绘制。
    const qY = xpY + barH + 8;   // 左上角文字信息的起始 y（沿用原来的排版）

    // ---------- 文字信息 ----------
    ctx.textBaseline = 'top';
    ctx.font = '14px Consolas, Menlo, monospace';
    ctx.fillStyle = 'rgba(230, 238, 255, 0.9)';
    const counts = { normal: 0, fast: 0, ranged: 0 };
    for (let i = 0; i < enemies.length; i++) {
      const k = enemies[i].kind || 'normal';
      if (counts[k] === undefined) counts[k] = 0;
      counts[k]++;
    }
    const phaseText = raid.phase === 'boss'
      ? 'BOSS 战'
      : (raid.phase === 'clear' ? '清场 ' + raid.clearTimer.toFixed(1) + 's' : '普通刷怪');

    // ---------- 击杀数 + Boss 进度 ----------
    // 格式：击杀: 123 (45/100)
    //   括号内 = 当前 Boss 进度 / 本轮触发所需进度。总击杀数 game.kills 永不清零，
    //   只有括号里的进度会在击败 Boss 后归零（Boss 战期间显示为满进度，如 150/150）。
    //   本轮门槛随轮回递增：100 → 150 → 200 …（见 bossProgressNeed）
    const need = bossProgressNeed();
    const bossProgress = Math.min(need, Math.round(raid.progress));
    const killLine = '击杀: ' + game.kills + ' (' + bossProgress + '/' + need + ')';
    // 距离下次触发还有多久（本轮存活计时这条线也一起给出来，方便玩家判断）
    const timeNeed = bossTriggerTime();
    const timeLeft = Math.max(0, timeNeed - raid.fightTime);

    const lines = [
      '存活: ' + game.time.toFixed(1) + 's',
      killLine,
      '敌人: ' + enemies.length +
        '（红 ' + counts.normal + ' / 黄 ' + counts.fast + ' / 紫 ' + counts.ranged + '）' +
        '   经验球: ' + orbs.length,
      '阶段: ' + phaseText + '   第 ' + (raid.round + 1) + ' 轮' +
        '   门槛 击杀 ' + need + ' / 存活 ' + timeNeed + 's' +
        (raid.phase === 'idle' ? '（还有 ' + timeLeft.toFixed(0) + 's）' : ''),
      '小怪强度 ×' + raidHpMul().toFixed(2) + ' 血 ×' + raidSpeedMul().toFixed(2) + ' 速' +
        '   已击败 BOSS ' + raid.round + ' 轮' +
        '   BOSS 强度 ×' + (1 + raid.round * CONFIG.boss.hpPerRound).toFixed(2) + ' 血 ×' +
        bossDamageMul().toFixed(2) + ' 伤',
      '攻击 ' + ((CONFIG.bullet.damage + player.attackFlat) * player.attackMul).toFixed(1) +
        '   攻速 ' + (1 / effectiveFireInterval()).toFixed(2) + '/s' +
        '   移速 ' + effectiveSpeed().toFixed(0),
      '子弹 ' + player.projectiles + '   半圆半径 ' + bladeRadius().toFixed(0) +
        '   冲刺 ' + (player.dashCd <= 0 && player.dashTime <= 0
          ? '就绪' : player.dashCd.toFixed(1) + 's') +
        (upgradeState.picked > 0 ? '   已选增益 ' + upgradeState.picked : '')
    ];
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], 14, qY + barH + 22 + i * 19);
    }

    // ---------- 操作提示（右下角，避开底部中央的技能图标）----------
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(230, 238, 255, 0.45)';
    ctx.font = '13px Consolas, Menlo, monospace';
    ctx.fillText('移动 WASD    冲刺 Shift（朝鼠标）    Q 大招    空格 暂停    静音 M',
      viewWidth - 14, viewHeight - 26);
    ctx.fillStyle = 'rgba(126, 240, 255, 0.5)';
    ctx.fillText('拔刀状态下：鼠标左键 扇形挥砍', viewWidth - 14, viewHeight - 46);

    // 音乐还没开始（浏览器不允许无交互自动播放）时给个提示
    if (!music.started && !music.silent) {
      ctx.fillStyle = 'rgba(255, 217, 61, 0.7)';
      ctx.fillText('点一下画面或按任意键开始播放背景音乐', viewWidth - 14, viewHeight - 66);
    }
    ctx.textAlign = 'left';
  }

  /**
   * 屏幕下方正中央的技能状态：两个圆形图标并排
   *   左：Shift 冲刺 -> 显示冷却倒计时 + 顺/逆时针扫描
   *   右：Q 大招   -> 显示能量百分比 + 环形进度
   * 拔刀状态时还会让 Q 图标脉动并显示剩余秒数。
   */
  function drawAbilities() {
    const R = 34;                 // 图标半径
    const gap = 24;
    const cy = viewHeight - R - 34;
    const dashX = viewWidth / 2 - R - gap / 2;
    const ultX = viewWidth / 2 + R + gap / 2;

    // 整块背板：让图标从背景里跳出来
    const panelW = R * 4 + gap + 40;
    const panelH = R * 2 + 46;
    ctx.fillStyle = 'rgba(8, 12, 20, 0.55)';
    ctx.fillRect(viewWidth / 2 - panelW / 2, cy - R - 20, panelW, panelH);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.lineWidth = 1;
    ctx.strokeRect(viewWidth / 2 - panelW / 2 + 0.5, cy - R - 20 + 0.5, panelW - 1, panelH - 1);

    drawDashIcon(dashX, cy, R);
    drawUltIcon(ultX, cy, R);
  }

  /** 圆形技能图标：统一绘制底盘 + 环形进度（环形从 12 点方向顺时针填充） */
  function drawAbilityBase(cx, cy, R, ringRatio, opts) {
    opts = opts || {};

    // 底盘
    ctx.fillStyle = opts.bg || 'rgba(20, 28, 42, 0.92)';
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();

    // 环形底
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cy, R - 3, 0, Math.PI * 2);
    ctx.stroke();

    // 环形进度
    const ratio = Math.max(0, Math.min(1, ringRatio));
    if (ratio > 0.001) {
      ctx.strokeStyle = opts.ring || '#7ef0ff';
      if (opts.glow) {
        ctx.shadowColor = opts.ring || '#7ef0ff';
        ctx.shadowBlur = 12;
      }
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(cx, cy, R - 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
    }

    // 内圈描边
    ctx.strokeStyle = opts.border || 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, R - 3, 0, Math.PI * 2);
    ctx.stroke();
  }

  /** 在圆心写主文字（大号）与副文字（小号，在圆下方） */
  function drawAbilityLabels(cx, cy, R, key, main, sub, mainColor, subColor) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 16px Consolas, Menlo, monospace';
    ctx.fillStyle = mainColor;
    ctx.fillText(main, cx, cy - 1);

    // 键位标签（圆内下方）
    ctx.font = 'bold 11px Consolas, Menlo, monospace';
    ctx.fillStyle = 'rgba(230, 238, 255, 0.55)';
    ctx.fillText(key, cx, cy + 15);

    // 圆下方的状态说明
    ctx.font = 'bold 12px Consolas, Menlo, monospace';
    ctx.fillStyle = subColor;
    ctx.fillText(sub, cx, cy + R + 14);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /** Shift 冲刺图标 */
  function drawDashIcon(cx, cy, R) {
    const ready = player.dashCd <= 0 && player.dashTime <= 0;
    // 冷却中：环形比例 = 剩余冷却比例（顺时针回缩），就绪时满环
    const ringRatio = ready ? 1 : 1 - Math.min(1, player.dashCd / CONFIG.dash.cooldown);

    drawAbilityBase(cx, cy, R, ringRatio, {
      ring: ready ? '#8ef0ff' : 'rgba(126, 240, 255, 0.55)',
      border: ready ? 'rgba(180, 245, 255, 0.85)' : 'rgba(255, 255, 255, 0.22)',
      glow: ready
    });

    // 图标：三道速度线
    ctx.strokeStyle = ready ? '#d6fbff' : 'rgba(214, 251, 255, 0.35)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = -1; i <= 1; i++) {
      const oy = cy - 8 + (i + 1) * 7;
      ctx.moveTo(cx - 11, oy);
      ctx.lineTo(cx + 9, oy);
    }
    ctx.stroke();
    // 箭头
    ctx.fillStyle = ready ? '#d6fbff' : 'rgba(214, 251, 255, 0.35)';
    ctx.beginPath();
    ctx.moveTo(cx + 15, cy - 1);
    ctx.lineTo(cx + 6, cy - 7);
    ctx.lineTo(cx + 6, cy + 5);
    ctx.closePath();
    ctx.fill();

    const main = ready ? '就绪' : player.dashCd.toFixed(1) + 's';
    const sub = ready ? '冲刺就绪' : '冲刺冷却 ' + player.dashCd.toFixed(1) + 's';
    drawAbilityLabels(cx, cy, R, 'Shift', main, sub,
      ready ? '#c8f8ff' : 'rgba(210, 245, 255, 0.85)',
      ready ? '#8ef0ff' : 'rgba(230, 238, 255, 0.6)');

    // 冷却中：把图标整体压暗一点（直观表示"不可用"）
    if (!ready) {
      ctx.fillStyle = 'rgba(6, 10, 18, 0.45)';
      ctx.beginPath();
      ctx.arc(cx, cy, R - 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Q 大招图标 */
  function drawUltIcon(cx, cy, R) {
    const ratio = Math.max(0, Math.min(1, game.energy / CONFIG.blade.energyMax));
    const full = isEnergyFull();
    const active = player.blade > 0;
    const pulse = 0.55 + 0.45 * Math.sin(game.time * 9);

    drawAbilityBase(cx, cy, R, active ? Math.max(0, player.blade / CONFIG.blade.duration) : ratio, {
      ring: active ? 'rgba(160, 245, 255, 0.85)' : (full ? '#bff8ff' : '#3f9fd8'),
      border: (full || active) ? 'rgba(200, 250, 255, 0.9)' : 'rgba(255, 255, 255, 0.22)',
      glow: full && !active
    });

    // 图标：交叉的双刀（简笔）
    ctx.strokeStyle = active ? '#ffffff' : (full ? '#eaffff' : 'rgba(190, 235, 255, 0.45)');
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy - 12);
    ctx.lineTo(cx + 10, cy + 8);
    ctx.moveTo(cx + 10, cy - 12);
    ctx.lineTo(cx - 10, cy + 8);
    ctx.stroke();
    // 刀柄
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 12, cy - 9);
    ctx.lineTo(cx - 8, cy - 13);
    ctx.moveTo(cx + 12, cy - 9);
    ctx.lineTo(cx + 8, cy - 13);
    ctx.stroke();

    const pct = Math.round(ratio * 100);
    const main = active ? '拔刀' : pct + '%';   // 始终显示能量百分比
    let sub;
    let subColor;
    if (active) {
      sub = '拔刀中 ' + player.blade.toFixed(1) + 's';
      subColor = 'rgba(160, 245, 255, ' + (0.6 + 0.4 * pulse).toFixed(3) + ')';
      // 拔刀中给图标加一圈脉动外环
      ctx.strokeStyle = 'rgba(160, 245, 255, ' + (0.35 * pulse).toFixed(3) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, R + 6 + 2 * pulse, 0, Math.PI * 2);
      ctx.stroke();
    } else if (full) {
      sub = '能量已满 · Q 释放';
      subColor = 'rgba(190, 250, 255, ' + (0.55 + 0.45 * pulse).toFixed(3) + ')';
    } else {
      sub = '能量 ' + pct + '%';
      subColor = 'rgba(230, 238, 255, 0.6)';
    }

    // 未满且未拔刀时压暗，明确"还放不了"
    if (!full && !active) {
      ctx.fillStyle = 'rgba(6, 10, 18, 0.38)';
      ctx.beginPath();
      ctx.arc(cx, cy, R - 4, 0, Math.PI * 2);
      ctx.fill();
    }

    drawAbilityLabels(cx, cy, R, 'Q', main, sub,
      (full || active) ? '#eaffff' : 'rgba(210, 245, 255, 0.9)',
      subColor);
  }

  /**
   * 屏幕顶部的 Boss 独立血条。
   * 和小怪头顶的小血条完全不同：这是一条横贯屏幕上方的长条，
   * 带轮次标签、剩余血量数值和清场倒计时提示。
   */
  function drawBossBar() {
    if (!boss) return;

    const w = Math.max(320, Math.min(760, viewWidth - 120));
    const h = 22;
    const bx = (viewWidth - w) / 2;
    const by = 40;
    const ratio = Math.max(0, Math.min(1, boss.hp / boss.maxHp));
    const pulse = 0.5 + 0.5 * Math.sin(game.time * 6);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 标题
    ctx.font = 'bold 15px Consolas, Menlo, monospace';
    ctx.fillStyle = 'rgba(255, 210, 210, ' + (0.75 + 0.25 * pulse).toFixed(3) + ')';
    ctx.fillText('BOSS · 第 ' + (raid.round + 1) + ' 轮', viewWidth / 2, by - 12);

    // 外框 + 底槽
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(bx - 3, by - 3, w + 6, h + 6);
    ctx.fillStyle = '#2a0d12';
    ctx.fillRect(bx, by, w, h);

    // 血量：暗红 -> 亮红的渐变，血量越低越偏向深色
    const grad = ctx.createLinearGradient(bx, 0, bx + w, 0);
    grad.addColorStop(0, '#7a0d18');
    grad.addColorStop(0.5, '#d92b3a');
    grad.addColorStop(1, '#ff5b5b');
    ctx.fillStyle = grad;
    ctx.fillRect(bx, by, w * ratio, h);

    // 血条上的高光条（顶部一条亮线，看起来更有质感）
    ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.fillRect(bx, by, w * ratio, h * 0.35);

    // 刻度（每 25% 一格，方便读进度）
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const x = Math.round(bx + (w / 4) * i) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, by);
      ctx.lineTo(x, by + h);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(255, 190, 190, 0.8)';
    ctx.lineWidth = 2;
    ctx.strokeRect(bx + 0.5, by + 0.5, w - 1, h - 1);

    // 数值
    ctx.font = 'bold 13px Consolas, Menlo, monospace';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(Math.ceil(boss.hp) + ' / ' + boss.maxHp, viewWidth / 2, by + h / 2 + 1);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  /** 屏幕中央的大字横幅（BOSS 来袭 / 清场 / 下一轮开始） */
  function drawBanner() {
    if (raid.bannerTimer <= 0 || !raid.banner) return;

    const t = Math.min(1, raid.bannerTimer / 0.5);   // 最后 0.5 秒淡出
    const y = viewHeight * 0.28;

    ctx.save();
    ctx.globalAlpha = 0.25 + 0.75 * t;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const big = raid.phase === 'boss';
    ctx.font = 'bold ' + (big ? 46 : 26) + 'px Consolas, Menlo, monospace';
    ctx.lineWidth = 4;

    // 先描一圈深色边，保证任何背景上都看得清
    ctx.strokeStyle = 'rgba(10, 6, 8, 0.85)';
    ctx.strokeText(raid.banner, viewWidth / 2, y);
    ctx.fillStyle = big ? '#ff5b5b' : '#ffd93d';
    ctx.fillText(raid.banner, viewWidth / 2, y);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /** 屏幕底部中间的倒计时提示（清场观望期：还要等几秒重新刷怪） */
  function drawClearCountdown() {
    if (raid.phase !== 'clear') return;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 18px Consolas, Menlo, monospace';
    ctx.fillStyle = 'rgba(255, 217, 61, 0.9)';
    ctx.fillText('清场中 · ' + raid.clearTimer.toFixed(1) + 's 后第 ' +
      (raid.round + 1) + ' 轮小怪刷新（更强）',
      viewWidth / 2, viewHeight * 0.34);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  function drawPaused() {
    ctx.fillStyle = 'rgba(8, 10, 16, 0.6)';
    ctx.fillRect(0, 0, viewWidth, viewHeight);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = '#e6eeff';
    ctx.font = 'bold 46px Consolas, Menlo, monospace';
    ctx.fillText('游戏已暂停', viewWidth / 2, viewHeight / 2 - 18);

    ctx.fillStyle = 'rgba(230, 238, 255, 0.7)';
    ctx.font = '17px Consolas, Menlo, monospace';
    ctx.fillText('按 P 或 空格 继续', viewWidth / 2, viewHeight / 2 + 42);

    // 显示暂停时的进度，方便确认时间真的冻住了
    ctx.fillStyle = 'rgba(230, 238, 255, 0.45)';
    ctx.font = '15px Consolas, Menlo, monospace';
    ctx.fillText('存活 ' + game.time.toFixed(1) + 's   击杀 ' + game.kills +
      '   等级 ' + game.level,
      viewWidth / 2, viewHeight / 2 + 78);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  function drawGameOver() {
    ctx.fillStyle = 'rgba(8, 10, 16, 0.72)';
    ctx.fillRect(0, 0, viewWidth, viewHeight);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = '#ff6b6b';
    ctx.font = 'bold 52px Consolas, Menlo, monospace';
    ctx.fillText('游戏结束', viewWidth / 2, viewHeight / 2 - 70);

    ctx.fillStyle = '#e6eeff';
    ctx.font = '20px Consolas, Menlo, monospace';
    ctx.fillText('存活时间: ' + game.time.toFixed(1) + ' 秒', viewWidth / 2, viewHeight / 2);
    ctx.fillText('击杀数: ' + game.kills + '      等级: ' + game.level, viewWidth / 2, viewHeight / 2 + 32);
    ctx.fillText('已选增益: ' + upgradeState.picked + ' 个', viewWidth / 2, viewHeight / 2 + 64);

    ctx.fillStyle = 'rgba(230, 238, 255, 0.7)';
    ctx.font = '16px Consolas, Menlo, monospace';
    ctx.fillText('按 R 重新开始', viewWidth / 2, viewHeight / 2 + 118);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  function render() {
    ctx.fillStyle = '#0d0f14';
    ctx.fillRect(0, 0, viewWidth, viewHeight);

    // 受伤屏幕震动
    let shakeX = 0;
    let shakeY = 0;
    if (game.shake > 0) {
      const power = game.shake * 26;
      shakeX = rand(-power, power);
      shakeY = rand(-power, power);
    }

    ctx.save();
    ctx.translate(shakeX, shakeY);

    drawGrid();
    drawWorldBorder();
    drawRocks();         // 环境掩体：石头画在网格之上、所有角色之下
    drawOrbs();
    drawShockRings();    // 弹幕预警环：贴在地面上，压在所有角色下面
    drawAfterimages();
    drawBladeCone();     // 玩家身下/身后的拔刀半圆（半透明，不会挡住敌人）
    drawEnemies();
    drawBoss();          // 巨大的暗红色方块 Boss
    drawBullets();
    drawPlayer();
    drawSlashFx();       // 释放瞬间的刀光，画在最上层
    drawParticles();     // 粒子压在刀光之上，刀锋火星不会被扇形盖住

    ctx.restore();

    drawHud();
    if (game.paused) drawPaused();
    if (game.over) drawGameOver();
    drawAbilities();     // 屏幕下方正中央的 Shift / Q 技能图标（画在最上层，暂停时也看得见）
    drawBossBar();       // 屏幕顶部的 Boss 独立血条
    drawClearCountdown();// 清场观望期的倒计时
    drawBanner();        // 屏幕中央的大字横幅（最上层）
  }

  // ------------------------------------------------------------
  //  重置 / 主循环
  // ------------------------------------------------------------
  function reset() {
    game.time = 0;
    game.kills = 0;
    game.over = false;
    game.paused = false;
    game.choosing = false;
    game.shake = 0;
    game.level = 1;
    game.xp = 0;
    game.xpNeed = xpNeeded(1);

    // 关掉可能开着的升级面板
    panelEl.classList.remove('show');
    canvas.classList.remove('paused-cursor');
    optionsEl.textContent = '';
    upgradeState.pending = 0;
    upgradeState.options = [];
    upgradeState.picked = 0;

    player.x = CONFIG.world.width / 2;
    player.y = CONFIG.world.height / 2;
    player.speed = CONFIG.player.speed;
    player.maxHp = CONFIG.player.maxHp;
    player.hp = player.maxHp;
    player.invuln = 0;
    player.flash = 0;
    player.facing.x = 1;
    player.facing.y = 0;

    // 射击间隔：player 与 CONFIG 都恢复默认（setFireInterval 可能改过 CONFIG）
    CONFIG.bullet.fireInterval = DEFAULT_FIRE_INTERVAL;

    // 升级带来的数值全部回到基础值
    player.attackMul = 1;
    player.attackFlat = 0;
    player.fireInterval = DEFAULT_FIRE_INTERVAL;
    player.projectiles = 1;
    player.xpMul = 1;
    player.pickupDist = CONFIG.orb.pickupDist;
    player.attractSpeed = CONFIG.orb.speed;

    // 源氏玩法状态
    game.energy = 0;
    game.ultimates = 0;
    player.dashTime = 0;
    player.dashCd = 0;
    player.dashDx = 1;
    player.dashDy = 0;
    player.blade = 0;
    player.slashCd = 0;
    player.healFlash = 0;

    enemies.length = 0;
    bullets.length = 0;
    orbs.length = 0;
    particles.length = 0;
    afterimages.length = 0;
    slashFx.length = 0;
    shockRings.length = 0;

    // ---- 环境掩体：每局重新随机 30~50 块岩石（生成时会避开出生点）----
    initializeRocks();
    // 玩家出生点固定在地图正中央：万一周围被石头围住，先把他挤到空地上
    settleActor(player, player.size / 2);

    // ---- Boss 战状态全部复位 ----
    boss = null;
    raid.phase = 'idle';
    raid.round = 0;
    raid.progress = 0;                          // Boss 进度从 0 开始
    raid.fightTime = 0;                         // 存活计时从 0 开始
    raid.clearTimer = 0;
    raid.banner = '';
    raid.bannerTimer = 0;
    raid.totalBossKills = 0;

    spawnTimer = 0;
    fireTimer = 0;
    trailTimer = 0;

    updateCamera();
  }

  window.addEventListener('keydown', function (e) {
    if (e.code === 'KeyR' && game.over) reset();
  });

  // 升级面板打开时：用 1 / 2 / 3 键直接选
  window.addEventListener('keydown', function (e) {
    if (!game.choosing) return;
    if (e.code === 'Digit1' || e.code === 'Numpad1') chooseUpgrade(0);
    else if (e.code === 'Digit2' || e.code === 'Numpad2') chooseUpgrade(1);
    else if (e.code === 'Digit3' || e.code === 'Numpad3') chooseUpgrade(2);
  });

  // ---------------- 互不干扰的技能按键 ----------------
  //   Shift = 冲刺（朝鼠标）        Q = 大招（能量满时拔刀）
  //   空格  = 只负责暂停/继续       P = 暂停/继续       M = 静音
  //   拔刀状态下：鼠标左键 = 扇形挥砍
  //  每个键只做一件事，不做"能量满了空格变大招"这种状态相关的分流。
  window.addEventListener('keydown', function (e) {
    if (e.repeat) return;
    if (game.over || game.paused || game.choosing) return;

    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      startDash();
    } else if (e.code === 'KeyQ') {
      useUltimate();   // 能量不满时内部直接返回 false，不会有副作用
    }
  });

  /** 暂停 / 继续：P 键或空格。游戏结束或正在选升级时不允许暂停。 */
  function togglePause() {
    if (game.over || game.choosing) return;
    game.paused = !game.paused;
    if (game.paused) {
      // 清空按键，避免暂停期间按住的方向键在恢复后"粘住"
      for (const k in keys) keys[k] = false;
    }
  }

  window.addEventListener('keydown', function (e) {
    if (e.code === 'KeyP' || e.code === 'Space') {
      togglePause();                    // 空格永远只负责暂停/继续
    } else if (e.code === 'KeyM') {
      toggleMute();
    }
  });

  // 鼠标左键：拔刀状态下朝鼠标方向扇形挥砍
  canvas.addEventListener('mousedown', function (e) {
    if (e.button !== undefined && e.button !== 0) return;   // 只响应左键
    updateAimFromEvent(e);
    startSlash();     // 非拔刀状态 / 冷却中会直接返回 false
  });

  /**
   * 音乐音量淡入/淡出（每帧调用）。
   * 淡出到 0 才真正 pause，避免开关声音时"啪"一下。
   */
  function updateMusic(dt) {
    const el = music.el;
    if (!el) return;

    const step = MUSIC.fadeIn > 0 ? (MUSIC.volume / MUSIC.fadeIn) * dt : MUSIC.volume;
    const v = el.volume;

    if (v < music.target) {
      el.volume = Math.min(music.target, v + step);
    } else if (v > music.target) {
      el.volume = Math.max(music.target, v - step);
    }

    // 静音淡出完成 -> 暂停播放，省点资源
    if (music.fadingOut && el.volume <= 0.001) {
      el.volume = 0;
      music.fadingOut = false;
      if (music.silent && !el.paused) el.pause();
    }
  }

  let lastTime = 0;

  function loop(now) {
    if (!lastTime) lastTime = now;
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    // 暂停 / 升级选择 / 结束时传 0，update 内部会立刻返回；
    // 关键是 lastTime 每帧都更新，所以恢复时不会补算一大段 dt 导致瞬移。
    if (game.paused || game.choosing || game.over) {
      update(0);
    } else {
      update(dt);
    }
    // 音乐淡入不受暂停影响，始终推进
    updateMusic(dt);
    render();

    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------
  //  启动
  // ------------------------------------------------------------
  resize();
  reset();
  armMusicStart();      // 等第一次点击/按键再启动背景音乐
  requestAnimationFrame(loop);

  // 调试接口：方便在浏览器控制台观察状态或自动化测试
  window.__GAME = {
    state: function () {
      return {
        time: game.time,
        kills: game.kills,
        over: game.over,
        paused: game.paused,
        choosing: game.choosing,
        level: game.level,
        xp: game.xp,
        xpNeed: game.xpNeed,
        pendingUpgrades: upgradeState.pending,
        picked: upgradeState.picked,
        options: upgradeState.options.map(function (o) {
          return { id: o.id, name: o.name, accent: o.accent };
        }),
        fireTimer: fireTimer,
        spawnTimer: spawnTimer,
        // ---- 源氏核心玩法状态 ----
        energy: game.energy,
        energyMax: CONFIG.blade.energyMax,
        energyFull: isEnergyFull(),
        ultimates: game.ultimates,
        blade: player.blade,
        bladeRadius: bladeRadius(),
        slashCd: player.slashCd,
        slashCooldown: effectiveSlashCooldown(),
        slashReady: player.blade > 0 && player.slashCd <= 0,
        canGainEnergy: canGainEnergy(),
        lifestealPerHit: CONFIG.blade.slash.lifesteal,
        healFlash: player.healFlash,
        dashTime: player.dashTime,
        dashCd: player.dashCd,
        dashReady: player.dashCd <= 0 && player.dashTime <= 0,
        afterimages: afterimages.length,
        slashFx: slashFx.length,
        aim: { x: aim.x, y: aim.y, has: aim.has },
        player: {
          x: player.x, y: player.y, hp: player.hp, maxHp: player.maxHp,
          speed: player.speed,
          effectiveSpeed: effectiveSpeed(),
          attackMul: player.attackMul,
          attackFlat: player.attackFlat,
          fireInterval: player.fireInterval,
          effectiveFireInterval: effectiveFireInterval(),
          projectiles: player.projectiles,
          xpMul: player.xpMul,
          pickupDist: player.pickupDist,
          bulletDamage: (CONFIG.bullet.damage + player.attackFlat) * player.attackMul
        },
        camera: { x: camera.x, y: camera.y },
        // ---- 地图与环境掩体 ----
        world: { width: CONFIG.world.width, height: CONFIG.world.height },
        rockCount: rocks.length,
        rocks: rocks.map(function (rk) {
          return { x: rk.x, y: rk.y, hw: rk.hw, hh: rk.hh };
        }),
        enemies: enemies.map(function (e) {
          return {
            x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp, size: e.size,
            kind: e.kind || 'normal', speed: e.speed,
            color: e.color || CONFIG.enemy.color,
            hostile: !!e.hostile,
            fireCd: e.fireCd,
            dashHit: !!e.dashHit
          };
        }),
        bullets: bullets.map(function (b) {
          return {
            x: b.x, y: b.y, damage: b.damage, radius: b.radius,
            hostile: !!b.hostile, traveled: b.traveled
          };
        }),
        orbs: orbs.map(function (o) { return { x: o.x, y: o.y }; }),
        particles: particles.length,
        // ---- Boss 战状态 ----
        raid: {
          phase: raid.phase,
          round: raid.round,
          progress: raid.progress,              // Boss 进度（击败后归零）
          progressNeed: bossProgressNeed(),     // 本轮所需击杀（随轮回递增）
          fightTime: raid.fightTime,            // 本轮存活计时（Boss 战后重新计时）
          triggerTime: bossTriggerTime(),       // 本轮计时门槛（随轮回递增）
          bossHpMul: 1 + raid.round * CONFIG.boss.hpPerRound,
          bossDamageMul: bossDamageMul(),
          clearTimer: raid.clearTimer,
          banner: raid.banner,
          bannerTimer: raid.bannerTimer,
          totalBossKills: raid.totalBossKills,
          shouldTrigger: raid.phase === 'idle' && bossShouldTrigger(),
          hpMul: raidHpMul(),
          speedMul: raidSpeedMul(),
          shockRings: shockRings.length
        },
        boss: boss ? {
          x: boss.x, y: boss.y, hp: boss.hp, maxHp: boss.maxHp, size: boss.size,
          speed: boss.speed, damage: boss.damage,
          barrageCd: boss.barrageCd,
          pendingWaves: boss.pendingWaves
        } : null,
        // ---- 冲刺伤害 ----
        dashDamage: dashDamage(),
        dashHits: enemies.length ? enemies.filter(function (e) { return e.dashHit; }).length : 0,
        // ---- 三种敌人的在场数量 ----
        enemyCounts: (function () {
          const c = { normal: 0, fast: 0, ranged: 0 };
          for (let i = 0; i < enemies.length; i++) {
            const k = enemies[i].kind || 'normal';
            if (c[k] === undefined) c[k] = 0;
            c[k]++;
          }
          return c;
        })()
      };
    },
    reset: reset,
    togglePause: togglePause,
    /** 测试用：手动推进一帧（不依赖 requestAnimationFrame） */
    step: function (dt) { update(dt); return game.time; },
    // 音频相关（测试用）
    toggleMute: toggleMute,
    setMuted: setMuted,
    playSfx: playSfx,
    initSfx: initSfx,
    fireBullet: fireBullet,
    spawnSlashEffect: spawnSlashEffect,
    sfx: function () {
      const vols = {};
      const gaps = {};
      const rates = {};
      for (const k in SFX_CONF) {
        vols[k] = SFX_CONF[k].volume;
        gaps[k] = SFX_CONF[k].minGap;
        rates[k] = SFX_CONF[k].rate === undefined ? 1 : SFX_CONF[k].rate;
      }
      return {
        files: SFX_FILES,
        volumes: vols,
        minGaps: gaps,
        rates: rates,
        ready: sfx.ready,
        loading: sfx.loading,
        usingFallback: sfx.usingFallback,
        hasContext: !!sfx.ctx,
        contextState: sfx.ctx ? sfx.ctx.state : null,
        masterGain: sfx.master ? sfx.master.gain.value : null,
        decoded: sfx.buffers ? Object.keys(sfx.buffers) : [],
        // 冲刺音效是实时合成的，没有音频文件；这里记录它响过几次
        synthesized: { dash: sfx.synthPlays || 0 },
        lastPlay: sfx.lastPlay
      };
    },
    music: function () {
      return {
        src: MUSIC.src,
        defaultVolume: MUSIC.volume,
        started: music.started,
        silent: music.silent,
        failed: music.failed,
        hasElement: !!music.el,
        volume: music.el ? music.el.volume : null,
        paused: music.el ? music.el.paused : null,
        loop: music.el ? music.el.loop : null,
        currentTime: music.el ? music.el.currentTime : null
      };
    },
    // 测试用：直接给经验 / 选择增益
    gainXp: gainXp,
    chooseUpgrade: chooseUpgrade,
    // 测试用：按 id 直接施加某个增益
    grantUpgrade: function (id) {
      for (let i = 0; i < UPGRADES.length; i++) {
        if (UPGRADES[i].id === id) {
          UPGRADES[i].apply();
          upgradeState.picked++;
          return true;
        }
      }
      return false;
    },
    // ---- 源氏核心玩法（测试用）----
    startDash: startDash,
    startSlash: startSlash,
    resetDashCd: function () { player.dashCd = 0; return true; },
    addEnergy: addEnergy,
    setEnergy: function (v) {
      game.energy = Math.max(0, Math.min(CONFIG.blade.energyMax, v));
      return game.energy;
    },
    fillEnergy: function () { game.energy = CONFIG.blade.energyMax; return game.energy; },
    useUltimate: useUltimate,
    bladeRadius: bladeRadius,
    /** 设置瞄准点（画布坐标）；传 world:true 时按世界坐标解释 */
    setAim: function (x, y, world) {
      aim.x = world ? x - camera.x : x;
      aim.y = world ? y - camera.y : y;
      aim.has = true;
      return { x: aim.x, y: aim.y };
    },
    // 测试用：查看某个增益的说明
    upgradeList: function () {
      return UPGRADES.map(function (u) {
        return { id: u.id, name: u.name, desc: u.desc, weight: u.weight };
      });
    },
    // 测试用：临时改刷怪间隔，隔离随机刷怪
    setSpawnInterval: function (v) { CONFIG.enemy.spawnInterval = v; },
    setFireInterval: function (v) { CONFIG.bullet.fireInterval = v; player.fireInterval = v; },
    spawnEnemy: spawnEnemy,
    spawnWave: spawnWave,
    // 测试用：按种类放怪（'normal' / 'fast' / 'ranged'），不传就是随机
    spawnEnemyKind: function (kind) { return spawnEnemy(kind); },
    enemyTypes: function () {
      return Object.keys(ENEMY_TYPES).map(function (k) {
        const t = ENEMY_TYPES[k];
        return {
          kind: t.kind, size: t.size, speed: t.speed, color: t.color,
          activeDist: t.activeDist, stopDist: t.stopDist,
          hostile: k === 'ranged'
        };
      });
    },
    // 测试用：场上紫色怪数量
    rangedCount: countRangedEnemies,
    /** 测试用：按当前权重连抽 n 次种类，返回各类型出现次数（用于验证刷新概率） */
    sampleKinds: function (n) {
      const out = { normal: 0, fast: 0, ranged: 0 };
      for (let i = 0; i < n; i++) {
        const k = pickEnemyKind();
        out[k] = (out[k] || 0) + 1;
      }
      return out;
    },
    // 测试用：让某个远程敌人立刻开一枪
    fireHostileBullet: fireHostileBullet,
    // 测试用：在指定位置放一个敌人（血量 / 移速同样吃轮次成长）
    spawnEnemyAt: function (x, y, hp, kind) {
      const type = ENEMY_TYPES[kind] || ENEMY_TYPES.normal;
      const e = makeEnemy(type, x, y);
      if (hp !== undefined) {
        e.hp = hp;
        e.maxHp = hp;
      }
      return pushEnemy(e);
    },
    killAllEnemies: function () {
      while (enemies.length) killEnemy(enemies[enemies.length - 1]);
    },
    // ---- 环境掩体（测试用）----
    /** 重新随机生成岩石，返回块数 */
    initRocks: function () { return initializeRocks(); },
    rocks: function () {
      return rocks.map(function (rk) {
        return { x: rk.x, y: rk.y, hw: rk.hw, hh: rk.hh };
      });
    },
    /** 在指定位置塞一块岩石（测试碰撞用），返回岩石对象 */
    addRock: function (x, y, hw, hh) {
      const rk = {
        x: x, y: y,
        hw: hw === undefined ? 60 : hw,
        hh: hh === undefined ? 60 : hh,
        seed: Math.random() * 1000
      };
      rocks.push(rk);
      rebuildRockGrid();
      return rk;
    },
    clearRocks: function () { rocks.length = 0; rebuildRockGrid(); },
    /** 某个圆是否和岩石重叠 / 视线是否被岩石挡住 */
    rockAt: function (x, y, radius) {
      return circleHitsAnyRock(x, y, radius === undefined ? 0 : radius);
    },
    rockBlocksLine: function (ax, ay, bx, by, pad) {
      return rockBlocksLine(ax, ay, bx, by, pad);
    },
    /** 把某个点挤出岩石（玩家 / 敌人移动后的收尾逻辑，测试可直接调用） */
    settleActor: function (x, y, radius) {
      const o = { x: x, y: y };
      settleActor(o, radius);
      return o;
    },
    // 测试用：直接设置玩家位置（会立刻做一次岩石 / 边界收尾）
    setPlayerPos: function (x, y) {
      player.x = x;
      player.y = y;
      settleActor(player, player.size / 2);
      return { x: player.x, y: player.y };
    },
    // ---- Boss 战（测试用）----
    startBossRaid: startBossRaid,
    addBossProgress: addBossProgress,
    fireBossBarrage: fireBossBarrage,
    defeatBoss: defeatBoss,
    damageBoss: damageBoss,
    clearAllEnemies: clearAllEnemies,
    bossShouldTrigger: bossShouldTrigger,
    boss: function () { return boss; },
    raid: function () { return raid; },
    hurtPlayer: hurtPlayer,
    config: CONFIG
  };
})();
