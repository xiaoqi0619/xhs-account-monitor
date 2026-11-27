import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {
  selectNewCommentUsersForRedId,
  selectNotesToInspect,
} from '../src/collector/xhs-collector.ts';
import { processCollectResult } from '../src/engine/diff-engine.ts';
import { runMidnightReconcileAndDailySummary } from '../src/engine/reconciler.ts';
import { MonitorScheduler } from '../src/engine/scheduler.ts';
import { NotificationHub } from '../src/notify/index.ts';
import { buildQqMailMimeMessage, QqMailNotifier } from '../src/notify/qq-mail.ts';
import { LOGS_DIR, NOTE_PHOTOS_DIR, REPORTS_DIR } from '../src/shared/paths.ts';
import type { AppConfig, CollectResult } from '../src/shared/types.ts';
import {
  DEFAULT_CONFIG,
  normalizeQqMailAddress,
  normalizeQqMailAuthCode,
} from '../src/shared/utils.ts';
import { MonitorDatabase } from '../src/storage/database.ts';
import { createWebApp } from '../src/web/server.ts';

async function runSelfTest(): Promise<void> {
  console.log('==============================================================');
  console.log('  开始执行小红书监控系统全链路自动化自检');
  console.log('==============================================================');

  const db = new MonitorDatabase(':memory:');
  const testConfig: AppConfig = {
    ...DEFAULT_CONFIG,
    targetProfileUrl: 'https://www.xiaohongshu.com/user/profile/test_uid_001',
    barkKey: '',
    qqMailUser: '',
    qqMailAuthCode: '',
    pushDailyReportToBark: false,
    timeDiffReviewThresholdMinutes: 40,
  };

  const cleanupPaths = [
    path.join(NOTE_PHOTOS_DIR, 'selftest_old_note'),
    path.join(NOTE_PHOTOS_DIR, 'selftest_day1_note'),
    path.join(NOTE_PHOTOS_DIR, 'selftest_new_note'),
    path.join(LOGS_DIR, 'events-2099-05-01.jsonl'),
    path.join(LOGS_DIR, 'events-2099-05-02.jsonl'),
    path.join(LOGS_DIR, 'comparisons-2099-05-01.jsonl'),
    path.join(LOGS_DIR, 'comparisons-2099-05-02.jsonl'),
    path.join(LOGS_DIR, 'ip-changes-2099-05-01.jsonl'),
    path.join(LOGS_DIR, 'ip-changes-2099-05-02.jsonl'),
    path.join(LOGS_DIR, 'profile-changes-2099-05-01.jsonl'),
    path.join(LOGS_DIR, 'profile-changes-2099-05-02.jsonl'),
    path.join(REPORTS_DIR, 'daily-report-2099-05-01.md'),
    path.join(REPORTS_DIR, 'daily-report-2099-05-01.json'),
  ];

  try {
    // ------------------------------------------------------------------
    // 测试 1：首次运行全量保存账号现有全部内容（含超过2天的老笔记、评论、照片备份）
    // ------------------------------------------------------------------
    const baselineTimeIso = new Date(2099, 4, 1, 14, 0, 0).toISOString(); // 2099-05-01 14:00:00
    const oldNotePublishMs = new Date(2099, 3, 20, 19, 35, 0).getTime(); // 11天前的老笔记（前端仅显示 04-20，无时分）
    const sameDayBaselineNoteMs = new Date(2099, 4, 1, 13, 40, 0).getTime();

    const baselineCollect: CollectResult = {
      status: 'OK',
      isFullCatalogScan: true,
      profile: {
        userId: 'test_uid_001',
        redId: 'xhs_test_888',
        nickname: '测试监控博主',
        gender: '女',
        avatar: 'https://example.com/avatar.webp',
        desc: '还没有简介',
        ipLocation: 'IP属地：上海',
        followsRaw: '120',
        followsNum: 120,
        fansRaw: '3500',
        fansNum: 3500,
        interactionRaw: '12000',
        interactionNum: 12000,
      },
      notes: [
        {
          noteId: 'selftest_old_note',
          xsecToken: 'tok1',
          title: '十天前的存量老笔记',
          desc: '这是首次运行全量归档保存的老笔记正文',
          noteType: 'normal',
          publishedAt: oldNotePublishMs,
          updatedAt: oldNotePublishMs,
          renderedTimeText: '04-20 上海', // 超过2天小红书页面不再显示具体 HH:mm
          ipLocation: '上海',
          likedRaw: '88',
          likedNum: 88,
          collectedRaw: '20',
          collectedNum: 20,
          commentRaw: '1',
          commentNum: 1,
          coverUrl: 'https://example.com/old_1.webp',
          imageUrls: ['https://example.com/old_1.webp', 'https://example.com/old_2.webp'],
          detailLoaded: true,
        },
        {
          noteId: 'selftest_day1_note',
          xsecToken: 'tok2',
          title: '首次运行当天刚发的笔记',
          desc: '当天下午发的动态',
          noteType: 'normal',
          publishedAt: null, // 模拟仅拿到相对时间「20分钟前」
          updatedAt: null,
          renderedTimeText: '20分钟前',
          ipLocation: '上海',
          likedRaw: '12',
          likedNum: 12,
          collectedRaw: '3',
          collectedNum: 3,
          commentRaw: '1',
          commentNum: 1,
          coverUrl: 'https://example.com/d1.webp',
          imageUrls: ['https://example.com/d1.webp'],
          detailLoaded: true,
        },
      ],
      noteComments: new Map([
        [
          'selftest_old_note',
          {
            noteId: 'selftest_old_note',
            isComplete: true,
            comments: [
              {
                commentId: 'c_old_1',
                noteId: 'selftest_old_note',
                parentId: null,
                userId: 'u_fan_1',
                nickname: '老粉丝A',
                userAvatar: '',
                targetNickname: '',
                content: '存量历史评论内容',
                createdAt: oldNotePublishMs + 600_000,
                renderedTimeText: '04-20',
                ipLocation: '北京',
                likeCountRaw: '5',
              },
            ],
          },
        ],
        [
          'selftest_day1_note',
          {
            noteId: 'selftest_day1_note',
            isComplete: true,
            comments: [
              {
                commentId: 'c_day1_1',
                noteId: 'selftest_day1_note',
                parentId: null,
                userId: 'u_fan_2',
                nickname: '路人B',
                userAvatar: '',
                targetNickname: '',
                content: '沙发评论！',
                createdAt: sameDayBaselineNoteMs + 300_000,
                renderedTimeText: '15分钟前',
                ipLocation: '广东',
                likeCountRaw: '1',
              },
            ],
          },
        ],
      ]),
    };

    const res1 = await processCollectResult(baselineCollect, db, testConfig, {
      skipMediaDownload: true,
      overrideNowIso: baselineTimeIso,
    });
    assert.equal(res1.isBaselineRun, true, '第1次运行应识别为首次全量存档');
    assert.equal(db.getArchiveStats().totalNotes, 2, '应全量保存2篇存量笔记');
    assert.equal(db.getArchiveStats().totalComments, 2, '应全量保存2条存量评论');
    assert.equal(db.getLatestIpRecord('test_uid_001', 'PROFILE')?.ipLocation, '上海', '首次建档应清洗前缀并保存初始IP基线');
    assert.equal(db.getLatestProfileFieldRecord('test_uid_001', 'NICKNAME')?.newValue, '测试监控博主');
    assert.equal(db.getLatestProfileFieldRecord('test_uid_001', 'GENDER')?.newValue, '女');
    assert.equal(db.getLatestProfileFieldRecord('test_uid_001', 'BIO')?.newValue, '', '默认「还没有简介」应归一化为空白个性签名基线');
    assert.equal(res1.events[0]?.eventType, 'BASELINE_READY', '应生成首次建档完成事件');
    console.log('✓ [通过] 1. 首次运行全量保存存量笔记、图文备份与全部历史评论');

    // ------------------------------------------------------------------
    // 测试 2：监控期间新发笔记 + 在超过2天的老笔记下出现新评论（对比本地笔记存档时间）
    // ------------------------------------------------------------------
    const patrol2TimeIso = new Date(2099, 4, 1, 21, 50, 0).toISOString(); // 2099-05-01 21:50:00
    const patrol2Collect: CollectResult = {
      status: 'OK',
      isFullCatalogScan: true,
      profile: {
        ...baselineCollect.profile!,
        nickname: '测试博主改名版',
        gender: '男',
        desc: '记录日常美食与减脂',
        avatar: 'https://sns-avatar-qc.xhscdn.com/avatar/new_avatar_key_002?imageView2/2/w/540',
        ipLocation: '广东',
        fansRaw: '3505',
        fansNum: 3505,
      },
      notes: [
        {
          noteId: 'selftest_new_note',
          xsecToken: 'tok3',
          title: '晚间新发夜宵打卡',
          desc: '好好吃的一顿夜宵',
          noteType: 'normal',
          publishedAt: null, // 当天仅显示「14分钟前」（实际 21:36 发布，待次日0点精确复核！）
          updatedAt: null,
          renderedTimeText: '14分钟前',
          ipLocation: '上海',
          likedRaw: '3',
          likedNum: 3,
          collectedRaw: '0',
          collectedNum: 0,
          commentRaw: '1',
          commentNum: 1,
          coverUrl: 'https://sns-webpic-qc.xhscdn.com/20990501/aaa/1040g_same_cover_id!nc_n_webp_mw_1',
          imageUrls: [
            'https://sns-webpic-qc.xhscdn.com/20990501/bbb/1040g_same_cover_id!nd_dft_wlteh_webp_3',
            'https://sns-webpic-qc.xhscdn.com/20990501/aaa/1040g_same_cover_id!nc_n_webp_mw_1',
          ],
          detailLoaded: true,
        },
        ...baselineCollect.notes!,
      ],
      noteComments: new Map([
        [
          'selftest_old_note',
          {
            noteId: 'selftest_old_note',
            isComplete: true,
            comments: [
              ...baselineCollect.noteComments!.get('selftest_old_note')!.comments,
              {
                commentId: 'c_new_on_old',
                noteId: 'selftest_old_note',
                parentId: null,
                userId: 'u_fan_3',
                userRedId: 'xhs_arch_99',
                nickname: '考古网友C',
                userAvatar: '',
                targetNickname: '',
                content: '十天后来考古评论啦！',
                createdAt: null,
                renderedTimeText: '5分钟前',
                ipLocation: '浙江',
                likeCountRaw: '0',
              },
            ],
          },
        ],
      ]),
    };

    const res2 = await processCollectResult(patrol2Collect, db, testConfig, {
      skipMediaDownload: true,
      overrideNowIso: patrol2TimeIso,
    });
    assert.equal(res2.isBaselineRun, false);
    const newCommentComp = res2.comparisons.find((c) => c.compareType === 'COMMENT_APPEARED');
    assert.ok(newCommentComp, '老笔记下出现新评论时必须生成 COMMENT_APPEARED 时间对比记录');
    assert.equal(
      newCommentComp.authorNickname,
      '考古网友C（xhs_arch_99）',
      '评论者名称后必须用括号附带小红书号'
    );
    assert.ok(
      newCommentComp.notePublishTime.includes('2099-04-20 19:35:00'),
      '即使老笔记已超过2天不再显示时分，对比记录仍必须调出本地锁定的精确发布时间'
    );
    const avatarComp = res2.comparisons.find((c) => c.compareType === 'AVATAR_CHANGED');
    assert.ok(avatarComp, '更换头像时必须生成 AVATAR_CHANGED 存档对比记录');
    assert.equal(db.getAvatarHistory('test_uid_001').length, 2, '本地头像历史库应同时保留旧头像与新头像共2条记录');
    const ipComp = res2.comparisons.find((c) => c.compareType === 'IP_CHANGED');
    assert.ok(ipComp, 'IP属地变更时必须生成 IP_CHANGED 存档对比记录');
    const ipHist2 = db.getIpHistory('test_uid_001');
    assert.equal(ipHist2.length, 2, '本地IP历史库应保留上海->广东共2条轨迹记录');
    assert.equal(ipHist2[0]?.previousIp, '上海', '最新IP记录应保存原IP属地');
    assert.equal(ipHist2[0]?.ipLocation, '广东', '最新IP记录应保存变更后IP属地');
    assert.ok(ipHist2[0]?.estimatedChangeWindow, 'IP变更记录应附带推算变更区间');
    assert.ok(
      fs.existsSync(path.join(LOGS_DIR, 'ip-changes-2099-05-01.jsonl')),
      'IP属地变更应同步追加到本地 ip-changes 日志文件'
    );
    assert.ok(
      res2.comparisons.find((c) => c.compareType === 'NICKNAME_CHANGED'),
      '名字变更时必须生成 NICKNAME_CHANGED 对比记录'
    );
    assert.ok(
      res2.comparisons.find((c) => c.compareType === 'GENDER_CHANGED'),
      '性别变更时必须生成 GENDER_CHANGED 对比记录'
    );
    const bioComp = res2.comparisons.find((c) => c.compareType === 'BIO_CHANGED');
    assert.ok(bioComp && bioComp.localSavedContent === '（空白）', '个性签名从空白变为有内容时必须记录 BIO_CHANGED');
    assert.ok(
      fs.existsSync(path.join(LOGS_DIR, 'profile-changes-2099-05-01.jsonl')),
      '资料变更应同步追加到本地 profile-changes 日志文件'
    );
    console.log('✓ [通过] 2. 新发笔记、头像/IP/名字/性别/签名变更存档 & 老笔记新评时间对比');

    // ------------------------------------------------------------------
    // 测试 3：删除笔记与删除评论检测（推算删除笔记的大概时间区间 + 保留本地备份）
    // ------------------------------------------------------------------
    const patrol3TimeIso = new Date(2099, 4, 1, 22, 20, 0).toISOString(); // 30分钟后巡检发现删帖与删评
    const patrol3Collect: CollectResult = {
      status: 'OK',
      isFullCatalogScan: true,
      profile: {
        ...patrol2Collect.profile!,
        // 模拟清空个性签名后页面恢复默认「还没有简介」
        desc: '还没有简介',
      },
      // selftest_day1_note 被删除！同时模拟老笔记在异地编辑后留下精确编辑时间与新IP「北京」
      notes: patrol2Collect
        .notes!.filter((n) => n.noteId !== 'selftest_day1_note')
        .map((n) =>
          n.noteId === 'selftest_old_note'
            ? {
                ...n,
                desc: '这是首次运行全量归档保存的老笔记正文（已补充编辑内容）',
                updatedAt: new Date(2099, 4, 1, 22, 15, 18).getTime(),
                ipLocation: '',
                renderedTimeText: '编辑于 22:15 北京',
              }
            : n
        ),
      confirmedUnavailableNoteIds: ['selftest_day1_note'],
      noteComments: new Map([
        [
          'selftest_old_note',
          {
            noteId: 'selftest_old_note',
            isComplete: true,
            // 老粉丝A的评论 c_old_1 被删除，仅剩 c_new_on_old
            comments: patrol2Collect
              .noteComments!.get('selftest_old_note')!
              .comments.filter((c) => c.commentId !== 'c_old_1'),
          },
        ],
      ]),
    };

    const res3 = await processCollectResult(patrol3Collect, db, testConfig, {
      skipMediaDownload: true,
      overrideNowIso: patrol3TimeIso,
    });

    const delNoteComp = res3.comparisons.find((c) => c.compareType === 'NOTE_DELETED');
    const delCommComp = res3.comparisons.find((c) => c.compareType === 'COMMENT_DELETED');
    assert.ok(delNoteComp, '必须生成删除笔记对比记录');
    assert.ok(
      delNoteComp.estimatedActionTimeText.includes('22:05:00') &&
        delNoteComp.estimatedActionTimeText.includes('误差 ±15 分钟'),
      `必须准确推算删除笔记的大概时间区间，实际为: ${delNoteComp.estimatedActionTimeText}`
    );
    assert.ok(delCommComp, '必须生成删除评论对比记录');
    const deletedStoredNote = db.getNote('selftest_day1_note');
    assert.equal(deletedStoredNote?.status, 'DELETED', '本地数据库中被删笔记应永久保留且标记为 DELETED');
    const noteIpComp = res3.comparisons.find(
      (c) => c.compareType === 'IP_CHANGED' && c.noteId === 'selftest_old_note'
    );
    assert.ok(noteIpComp, '老笔记编辑后 IP 属地由上海变为北京时必须记录 NOTE 级 IP_CHANGED');
    assert.equal(
      db.getLatestIpRecord('test_uid_001', 'PROFILE')?.ipLocation,
      '广东',
      '笔记级 IP 变动不应覆盖账号主页 IP 属地基线'
    );
    assert.equal(db.getIpHistory('test_uid_001').length, 3, '本地 IP 历史库应同时保存主页变更与笔记IP变更共3条记录');
    const editedStoredNote = db.getNote('selftest_old_note')!;
    assert.equal(
      editedStoredNote.lastEditedTimeText,
      '2099-05-01 22:15:18',
      '笔记编辑后必须将精确编辑时间永久记录到本地 notes 表'
    );
    const oldNoteRevisions = db.getNoteRevisions('selftest_old_note');
    assert.equal(oldNoteRevisions.length, 1, '编辑记录表 note_revisions 应保存 1 条带编辑时间的版本记录');
    assert.equal(
      oldNoteRevisions[0]?.editedTimeText,
      '2099-05-01 22:15:18',
      'note_revisions 必须记录精确编辑时间'
    );
    const editComp = res3.comparisons.find(
      (c) => c.compareType === 'NOTE_EDITED' && c.noteId === 'selftest_old_note'
    );
    assert.ok(
      editComp && editComp.estimatedActionTimeText.includes('2099-05-01 22:15:18'),
      'NOTE_EDITED 对比记录必须包含平台留下的编辑时间'
    );
    const clearBioComp = res3.comparisons.find((c) => c.compareType === 'BIO_CHANGED');
    assert.ok(
      clearBioComp && clearBioComp.newContentIfEdited === '（空白）',
      '清空个性签名恢复默认占位时必须记录由原签名变为空白'
    );
    console.log('✓ [通过] 3. 删除笔记、删除评论、笔记编辑时间、签名清空与笔记IP属地变更检测');

    // ------------------------------------------------------------------
    // 测试 4：次日 0 点（00:02）跨零点抓取「昨天 HH:mm」具体时间并与当天记录时间对照汇总
    // ------------------------------------------------------------------
    const midnightTimeIso = new Date(2099, 4, 2, 0, 2, 0).toISOString(); // 次日 2099-05-02 00:02:00
    const midnightCollect: CollectResult = {
      status: 'OK',
      isFullCatalogScan: false,
      profile: patrol3Collect.profile,
      notes: [
        {
          ...patrol2Collect.notes![0], // selftest_new_note
          // 跨过0点后，小红书前端显现出前一天发布的具体时间「昨天 21:36」！
          renderedTimeText: '昨天 21:36 上海',
        },
        patrol3Collect.notes![1], // selftest_old_note（延续第3轮编辑后的北京IP状态）
      ],
      noteComments: new Map([
        [
          'selftest_old_note',
          {
            noteId: 'selftest_old_note',
            isComplete: true,
            comments: [
              {
                ...patrol2Collect.noteComments!.get('selftest_old_note')!.comments[1], // c_new_on_old
                // 跨过0点后，评论也显现出具体时间「昨天 21:45」！
                renderedTimeText: '昨天 21:45',
              },
            ],
          },
        ],
      ]),
    };

    await processCollectResult(midnightCollect, db, testConfig, {
      skipMediaDownload: true,
      overrideNowIso: midnightTimeIso,
    });

    const { report } = runMidnightReconcileAndDailySummary(
      db,
      testConfig,
      '2099-05-01',
      {
        isNextDayVerified: true,
        overrideCheckNowIso: midnightTimeIso,
      }
    );

    const verifiedNewNote = db.getNote('selftest_new_note')!;
    assert.equal(
      verifiedNewNote.verifiedTimeText,
      '2099-05-01 21:36:00',
      '次日0点必须将「昨天 21:36」永久锁入本地笔记表，防止2天后前端隐藏时分'
    );

    const noteRec = report.timeReconciliations.find(
      (r) => r.itemType === 'NOTE' && r.targetId === 'selftest_new_note'
    );
    assert.ok(noteRec, '次日0点报告必须包含昨日新发笔记的时间对照项');
    assert.equal(noteRec.captureDelayMinutes, 14, '当天 21:50 捕获 vs 实际 21:36 发布，延迟应精确为 14 分钟');
    assert.equal(noteRec.status, 'MATCHED', '14分钟在40分钟阈值内应判定为 MATCHED');

    const deletedBeforeMidnightRec = report.timeReconciliations.find(
      (r) => r.itemType === 'NOTE' && r.targetId === 'selftest_day1_note'
    );
    assert.equal(
      deletedBeforeMidnightRec?.status,
      'DELETED_BEFORE_MIDNIGHT',
      '0点前已删笔记应在次日汇总中清晰标注 0点前已删除'
    );
    assert.ok((report.counts.ipChanges || 0) >= 2, '次日汇总报告应统计当日 IP 属地变更次数');
    assert.equal(report.account.ipLocationStart, '上海', '次日汇总报告应记录当日初始 IP 属地');
    assert.equal(report.account.ipLocationEnd, '广东', '次日汇总报告应记录当日结束 IP 属地');
    console.log('✓ [通过] 4. 次日0点「昨天 HH:mm」精确时间永久锁定 & 与当天本地记录时间对照汇总');

    // ------------------------------------------------------------------
    // 测试 5：Web 控制台 API 路由连通性校验
    // ------------------------------------------------------------------
    const scheduler = new MonitorScheduler(db, testConfig);
    const app = createWebApp(db, scheduler);

    const rOverview = await app.request('/api/overview');
    assert.equal(rOverview.status, 200);
    const rIp = await app.request('/api/ip-history');
    assert.equal(rIp.status, 200);
    const ipApiJson = (await rIp.json()) as {
      ok: boolean;
      currentIp: string;
      totalChanges: number;
      history: unknown[];
    };
    assert.equal(ipApiJson.ok, true);
    assert.equal(ipApiJson.currentIp, '广东');
    assert.equal(ipApiJson.totalChanges, 2);
    assert.equal(ipApiJson.history.length, 3);
    const rComp = await app.request('/api/comparisons?type=IP_CHANGED');
    assert.equal(rComp.status, 200);
    const compIpJson = (await rComp.json()) as { ok: boolean; records: unknown[] };
    assert.equal(compIpJson.records.length, 2);
    const rReport = await app.request('/api/daily-report?date=2099-05-01');
    assert.equal(rReport.status, 200);
    const rEditedNotes = await app.request('/api/notes?filter=EDITED');
    assert.equal(rEditedNotes.status, 200);
    const editedNotesJson = (await rEditedNotes.json()) as {
      ok: boolean;
      notes: Array<{ noteId: string; lastEditedTimeText: string }>;
    };
    assert.equal(editedNotesJson.notes.length, 1, 'EDITED 筛选应精准返回 1 篇已编辑笔记');
    assert.equal(editedNotesJson.notes[0]?.lastEditedTimeText, '2099-05-01 22:15:18');
    const rNoteDetail = await app.request('/api/notes/selftest_old_note');
    assert.equal(rNoteDetail.status, 200);
    const noteDetailJson = (await rNoteDetail.json()) as {
      ok: boolean;
      revisions: Array<{ editedTimeText: string }>;
    };
    assert.equal(noteDetailJson.revisions.length, 1, '单篇笔记详情接口应返回编辑历史 revisions');
    assert.equal(noteDetailJson.revisions[0]?.editedTimeText, '2099-05-01 22:15:18');
    const rProfileHist = await app.request('/api/profile-history');
    assert.equal(rProfileHist.status, 200);
    const profHistJson = (await rProfileHist.json()) as {
      ok: boolean;
      totalChanges: number;
      current: { nickname: string; gender: string; bio: string };
      history: unknown[];
    };
    assert.equal(profHistJson.ok, true);
    assert.equal(profHistJson.current.nickname, '测试博主改名版');
    assert.equal(profHistJson.current.gender, '男');
    assert.equal(profHistJson.current.bio, '');
    assert.equal(profHistJson.totalChanges, 4, '应累计记录 1次改名 + 1次改性别 + 2次改签名 = 4次资料变更');
    const rHtml = await app.request('/');
    assert.equal(rHtml.status, 200);
    const htmlBody = await rHtml.text();
    assert.ok(htmlBody.includes('ipHistoryTbody'), 'Web 控制台页面应包含 IP 属地历史存档表');
    assert.ok(htmlBody.includes('profileHistoryTbody'), 'Web 控制台页面应包含资料变更历史存档表');
    assert.ok(htmlBody.includes('nextRunCard') && htmlBody.includes('cdTimer'), 'Web 控制台应包含独立的下次监控倒计时模块');
    assert.ok(htmlBody.includes('当天汇总'), '顶部按钮应改为通俗名称「当天汇总」');
    assert.ok(htmlBody.includes('检查全部笔记') && htmlBody.includes('fullScanBtn'), '顶部应包含「检查全部笔记」按钮');
    assert.ok(
      htmlBody.includes('cfg_lightCheckMinMinutes') &&
        htmlBody.includes('cfg_fullScanMinMinutes') &&
        htmlBody.includes('cfg_burstExtraRecentNotes') &&
        htmlBody.includes('cfg_qqMailUser') &&
        htmlBody.includes('cfg_qqMailAuthCode') &&
        htmlBody.includes('testQqMail') &&
        htmlBody.includes('floatingTip'),
      '设置页应开放三态分层区间、QQ 邮箱通知与防遮挡悬浮提示层'
    );
    assert.ok(!htmlBody.includes('cfg_qqMailTo'), '设置页应已完全移除收件邮箱选项');
    assert.ok(
      !htmlBody.includes('cfg_enableWindowsToast') && !htmlBody.includes('testWindowsToast'),
      '设置页应已完全移除 Windows 桌面弹窗配置'
    );
    assert.ok(
      !htmlBody.includes('cfg_fetchCommentUserRedId'),
      '设置页应已移除新评论者查小红书号选项'
    );
    assert.ok(
      !htmlBody.includes('cfg_timeDiffReviewThresholdMinutes'),
      '设置页应已移除时间提醒阈值选项'
    );
    assert.equal(DEFAULT_CONFIG.fetchCommentUserRedId, true, '新评论者查小红书号应保持默认开启');
    assert.equal(DEFAULT_CONFIG.timeDiffReviewThresholdMinutes, 40, '时间提醒阈值应保持默认 40 分钟');
    assert.ok(!htmlBody.includes('cfg_maxNotesInspectPerRun'), '设置页应已删除单次监控笔记篇数限制');
    assert.ok(!htmlBody.includes('全量对账'), '页面不应再残留生涩词「全量对账」');
    assert.ok(htmlBody.includes('value="IP_CHANGED"'), 'Web 控制台筛选器应支持筛选 IP_CHANGED');
    assert.ok(htmlBody.includes('value="NICKNAME_CHANGED"'), 'Web 控制台筛选器应支持筛选 NICKNAME_CHANGED');
    assert.ok(htmlBody.includes('value="GENDER_CHANGED"'), 'Web 控制台筛选器应支持筛选 GENDER_CHANGED');
    assert.ok(htmlBody.includes('value="BIO_CHANGED"'), 'Web 控制台筛选器应支持筛选 BIO_CHANGED');
    const scriptMatch = htmlBody.match(/<script>([\s\S]*?)<\/script>/);
    assert.ok(scriptMatch && scriptMatch[1], 'Web 控制台应包含内联前端脚本');
    new vm.Script(scriptMatch[1]);
    console.log('✓ [通过] 5. 本地可视化 Web 控制台（Linear 风格脚本语法校验）与 REST API 校验通过');

    // ------------------------------------------------------------------
    // 测试 6：三态分层选帖规则 & 评论者小红书号本地缓存防重查校验
    // ------------------------------------------------------------------
    const mockCatalog = Array.from({ length: 8 }, (_, idx) => ({
      noteId: `n_${idx + 1}`,
      xsecToken: '',
      title: `笔记 ${idx + 1}`,
      desc: '',
      noteType: 'normal',
      publishedAt: null,
      updatedAt: null,
      renderedTimeText: '',
      ipLocation: '',
      likedRaw: '10',
      likedNum: 10,
      collectedRaw: '0',
      collectedNum: 0,
      commentRaw: '0',
      commentNum: 0,
      coverUrl: '',
      imageUrls: [],
      detailLoaded: false,
    }));
    const knownSnaps: Record<string, { title: string; likedNum: number }> = {};
    for (const n of mockCatalog) knownSnaps[n.noteId] = { title: n.title, likedNum: n.likedNum };

    // 6.1 轻量主页无变动 -> 0 篇进详情
    const lightQuiet = selectNotesToInspect({
      mode: 'PROFILE_LIGHT',
      catalogNotes: mockCatalog,
      knownNoteSnapshots: knownSnaps,
      knownProfileInteractionNum: 100,
      currentProfileInteractionNum: 100,
    });
    assert.equal(lightQuiet.inspectIds.size, 0, '轻量主页模式无变化时应只刷主页 1 页（0 篇进详情）');

    // 6.2 轻量主页仅 n_6 点赞变化 -> 仅进 n_6
    const changedCatalog = mockCatalog.map((n) =>
      n.noteId === 'n_6' ? { ...n, likedNum: 11, likedRaw: '11' } : n
    );
    const lightOneChanged = selectNotesToInspect({
      mode: 'PROFILE_LIGHT',
      catalogNotes: changedCatalog,
      knownNoteSnapshots: knownSnaps,
      knownProfileInteractionNum: 100,
      currentProfileInteractionNum: 101,
    });
    assert.deepEqual(
      Array.from(lightOneChanged.inspectIds),
      ['n_6'],
      '轻量主页发现单篇变动时，当轮应仅深入检查该变动帖'
    );

    // 6.3 轻量主页总赞藏变了但各卡片点赞没变（疑似收藏变化）-> 自动升级全部笔记
    const lightHiddenChange = selectNotesToInspect({
      mode: 'PROFILE_LIGHT',
      catalogNotes: mockCatalog,
      knownNoteSnapshots: knownSnaps,
      knownProfileInteractionNum: 100,
      currentProfileInteractionNum: 102,
    });
    assert.equal(lightHiddenChange.escalatedToFull, true);
    assert.equal(lightHiddenChange.inspectIds.size, 8, '总赞藏变了但单帖点赞未变时应升级检查全部笔记');

    // 6.4 定期全量 FULL_SCAN -> 全部 8 篇
    const fullScanSel = selectNotesToInspect({
      mode: 'FULL_SCAN',
      catalogNotes: mockCatalog,
      knownNoteSnapshots: knownSnaps,
    });
    assert.equal(fullScanSel.inspectIds.size, 8, 'FULL_SCAN 应检查全部笔记');

    // 6.5 高频 BURST_CHECK：变动帖 n_6 + 除变动帖外最新 4 篇 (n_1..n_4) = 5 篇
    const burstSel = selectNotesToInspect({
      mode: 'BURST_CHECK',
      catalogNotes: mockCatalog,
      knownNoteSnapshots: knownSnaps,
      priorityInspectNoteIds: ['n_6'],
      burstExtraRecentNotesCount: 4,
    });
    assert.deepEqual(
      Array.from(burstSel.inspectIds).sort(),
      ['n_1', 'n_2', 'n_3', 'n_4', 'n_6'],
      '高频模式应精准检查「变动帖 + 除变动帖外最新 4 篇」'
    );

    // 6.6 评论者小红书号缓存防重查校验
    db.upsertUserRedId('u_cached_ok', 'red_cached_888');
    db.upsertUserRedId('u_cached_unknown', 'UNKNOWN');
    const allCachedMap = db.getAllCachedUserRedIds();
    assert.equal(allCachedMap['u_cached_ok'], 'red_cached_888');
    assert.equal(allCachedMap['u_cached_unknown'], 'UNKNOWN');

    const mockNoteComments = new Map([
      [
        'n_1',
        {
          noteId: 'n_1',
          isComplete: true,
          comments: [
            {
              commentId: 'cm1',
              noteId: 'n_1',
              parentId: null,
              userId: 'u_cached_ok',
              nickname: '老用户A',
              userAvatar: '',
              targetNickname: '',
              content: 'hello',
              createdAt: null,
              renderedTimeText: '',
              ipLocation: '',
              likeCountRaw: '0',
            },
            {
              commentId: 'cm2',
              noteId: 'n_1',
              parentId: null,
              userId: 'u_cached_unknown',
              nickname: '注销用户B',
              userAvatar: '',
              targetNickname: '',
              content: 'hi',
              createdAt: null,
              renderedTimeText: '',
              ipLocation: '',
              likeCountRaw: '0',
            },
            {
              commentId: 'cm3',
              noteId: 'n_1',
              parentId: null,
              userId: 'u_brand_new',
              userXsecToken: 'tok_new',
              nickname: '新评论者C',
              userAvatar: '',
              targetNickname: '',
              content: 'new',
              createdAt: null,
              renderedTimeText: '',
              ipLocation: '',
              likeCountRaw: '0',
            },
          ],
        },
      ],
    ]);

    const pendingNewUsers = selectNewCommentUsersForRedId({
      noteComments: mockNoteComments,
      knownUserRedIds: { ...allCachedMap },
      enabled: true,
      maxPerRun: 5,
    });
    assert.deepEqual(
      pendingNewUsers,
      [['u_brand_new', 'tok_new']],
      '已有小红书号和已标记 UNKNOWN 的评论者绝不重复查询，仅查全新评论者'
    );
    const pendingDisabled = selectNewCommentUsersForRedId({
      noteComments: mockNoteComments,
      knownUserRedIds: { ...allCachedMap },
      enabled: false,
      maxPerRun: 5,
    });
    assert.equal(pendingDisabled.length, 0, '关闭开关时应跳过全部评论者主页查询');

    // 6.7 QQ 邮箱通知通道配置校验、MIME 构建与 NotificationHub 路由校验
    assert.equal(normalizeQqMailAddress('12345678'), '12345678@qq.com', '纯 QQ 号应自动补全 @qq.com');
    assert.equal(normalizeQqMailAuthCode('abcd efgh ijkl mnop'), 'abcdefghijklmnop', '授权码应自动去除空格');
    const mailOff = new QqMailNotifier({ user: '', authCode: '' });
    const mailOn = new QqMailNotifier({ user: '12345678', authCode: 'abcd efgh ijkl mnop' });
    assert.equal(mailOff.isConfigured(), false, '未填 QQ 邮箱与授权码时不应激活');
    assert.equal(mailOn.isConfigured(), true, '填写 QQ 号与授权码后通道应激活');
    const mimeMsg = buildQqMailMimeMessage({
      from: '12345678@qq.com',
      to: '12345678@qq.com',
      payload: {
        title: '【新发笔记】测试提醒',
        body: '发现新笔记\n第二行内容',
        level: 'timeSensitive',
        url: 'http://localhost:3000/#note-1',
      },
    });
    assert.ok(mimeMsg.includes('Subject: =?UTF-8?B?'), '邮件主题应采用 UTF-8 Base64 编码');
    assert.ok(mimeMsg.includes('Content-Type: text/html; charset=UTF-8'), '邮件正文应为 UTF-8 HTML');
    const [, rawB64Body] = mimeMsg.split('\r\n\r\n');
    const decodedHtml = Buffer.from((rawB64Body || '').replace(/\r\n/g, ''), 'base64').toString('utf8');
    assert.ok(
      decodedHtml.includes('【新发笔记】测试提醒') && decodedHtml.includes('http://localhost:3000/#note-1'),
      'Base64 解码后的 HTML 正文应完整保留中文标题与跳转链接'
    );
    const hubNone = new NotificationHub({ ...testConfig, barkKey: '', qqMailUser: '', qqMailAuthCode: '' });
    const hubQqOnly = new NotificationHub({
      ...testConfig,
      barkKey: '',
      qqMailUser: '12345678@qq.com',
      qqMailAuthCode: 'abcdefghijklmnop',
    });
    assert.equal(hubNone.hasActiveChannel(), false, 'Bark 与 QQ 邮箱均未配置时不应有活跃通道');
    assert.equal(hubQqOnly.hasActiveChannel(), true, '仅配置 QQ 邮箱时应可独立触发通知');
    const rTestMailOff = await app.request('/api/actions/test-qq-mail', { method: 'POST' });
    assert.equal(rTestMailOff.status, 200);
    const testMailOffJson = (await rTestMailOff.json()) as { ok: boolean };
    assert.equal(testMailOffJson.ok, false, '未配置 QQ 邮箱时测试邮件接口应返回 ok=false');
    console.log('✓ [通过] 6. 三态分层选帖、评论者缓存防重查与 QQ 邮箱 SMTPS 通知通道校验');

    console.log('==============================================================');
    console.log('  全部 6 大核心测试场景 100% 通过！');
    console.log('==============================================================');
  } finally {
    db.close();
    for (const p of cleanupPaths) {
      if (fs.existsSync(p)) {
        fs.rmSync(p, { recursive: true, force: true });
      }
    }
  }
}

runSelfTest().catch((err) => {
  console.error('[自检失败]', err);
  process.exit(1);
});
