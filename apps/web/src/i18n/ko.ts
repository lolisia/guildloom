/**
 * Every user-facing Korean string for M1.
 *
 * Later tasks (board, quest drawer, ledger, settings) must import from this
 * module instead of hard-coding copy, so the whole UI can be translated or
 * reworded from one place. The `bulk.confirm` template, the board column
 * labels, the drawer labels, the ledger column labels and the relative-time
 * helpers are part of the T06 interface and must not be renamed.
 */
import { MEMBER_STATUS_LABELS, type Notification } from "@guildloom/shared";

/** Confirm prompt shown before bulk-creating quests from pasted titles. */
const bulkConfirm = (count: number): string =>
  `${count}건을 의뢰로 등록할까요?`;

/** Quest wording fallback when a notification carries no title. */
const NOTIFICATION_QUEST_FALLBACK = "의뢰";

/** Actor wording fallback when a system notification has no actor. */
const NOTIFICATION_UNKNOWN_ACTOR = "어떤 모험가";

/** `#12 '로그인 버그'` style quest label used by notification copy. */
const notificationQuestLabel = (
  questNumber: number | null,
  questTitle: string | null,
): string => {
  if (questTitle === null) {
    return NOTIFICATION_QUEST_FALLBACK;
  }
  return questNumber === null
    ? `'${questTitle}'`
    : `#${questNumber} '${questTitle}'`;
};

/**
 * One Korean sentence per notification type.
 *
 * `actor` is the adventurer who triggered the notification (a system event
 * falls back to {@link NOTIFICATION_UNKNOWN_ACTOR}) and `quest` is the label
 * produced by {@link notificationQuestLabel}.
 */
const notificationTemplates = {
  nominated: (actor: string, quest: string): string =>
    `${actor}님이 ${quest}에 지목했습니다.`,
  relayed: (actor: string, quest: string): string =>
    `${actor}님이 ${quest}를 토스했습니다.`,
  reinforce: (actor: string, quest: string): string =>
    `${actor}님이 ${quest}에 증원을 요청했습니다.`,
  boss_engaged: (quest: string): string =>
    `${quest}의 보스전이 시작되었습니다.`,
  retry_requested: (actor: string, quest: string): string =>
    `${actor}님이 ${quest}의 재도전을 요청했습니다.`,
  quest_cleared: (quest: string): string => `${quest}를 클리어했습니다.`,
  clear_revoked: (actor: string, quest: string, xpRevoked: number): string =>
    `${actor}님이 ${quest}의 클리어를 취소했습니다. (XP ${xpRevoked.toLocaleString("ko-KR")} 회수)`,
};

/** XP taken back by a `clear_revoked` notification payload. */
function revokedXp(payload: unknown): number {
  if (typeof payload !== "object" || payload === null) {
    return 0;
  }
  const value = (payload as { xpRevoked?: unknown }).xpRevoked;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Render a notification row (and its toast) as one Korean sentence. */
function formatNotification(notification: Notification): string {
  const quest = notificationQuestLabel(
    notification.questNumber,
    notification.questTitle,
  );
  const actor =
    notification.actor?.displayName ?? NOTIFICATION_UNKNOWN_ACTOR;

  switch (notification.type) {
    case "nominated":
      return notificationTemplates.nominated(actor, quest);
    case "relayed":
      return notificationTemplates.relayed(actor, quest);
    case "reinforce":
      return notificationTemplates.reinforce(actor, quest);
    case "boss_engaged":
      return notificationTemplates.boss_engaged(quest);
    case "retry_requested":
      return notificationTemplates.retry_requested(actor, quest);
    case "quest_cleared":
      return notificationTemplates.quest_cleared(quest);
    case "clear_revoked":
      return notificationTemplates.clear_revoked(
        actor,
        quest,
        revokedXp(notification.payload),
      );
  }
}

/** Relative-time labels shared by the ledger and the quest event history. */
export const timeStrings = {
  justNow: "방금 전",
  minutesAgo: (minutes: number): string => `${minutes}분 전`,
  hoursAgo: (hours: number): string => `${hours}시간 전`,
  daysAgo: (days: number): string => `${days}일 전`,
  /**
   * Render an epoch-millisecond timestamp relative to `now`.
   *
   * Under a minute (or in the future) counts as "방금 전"; below an hour uses
   * minutes, below a day uses hours, and anything older uses days.
   */
  relative: (timestampMs: number, nowMs: number = Date.now()): string => {
    const elapsed = nowMs - timestampMs;
    if (!Number.isFinite(elapsed) || elapsed < 60_000) {
      return timeStrings.justNow;
    }

    const minutes = Math.floor(elapsed / 60_000);
    if (minutes < 60) {
      return timeStrings.minutesAgo(minutes);
    }

    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return timeStrings.hoursAgo(hours);
    }

    return timeStrings.daysAgo(Math.floor(hours / 24));
  },
};

export const ko = {
  common: {
    appName: "guildloom",
    loading: "불러오는 중…",
    retry: "다시 시도",
    cancel: "취소",
    close: "닫기",
    save: "저장",
    saving: "저장 중…",
    create: "만들기",
    creating: "만드는 중…",
    edit: "수정",
    delete: "삭제",
    confirm: "확인",
    search: "검색",
    all: "전체",
    none: "없음",
    optional: "선택",
    required: "필수",
    copy: "복사",
    copied: "복사했습니다.",
    copyFailed: "복사하지 못했습니다.",
    back: "뒤로",
    unknown: "알 수 없음",
    comingSoon: "이 화면은 다음 작업에서 완성됩니다.",
    noProjects: "아직 참여한 길드가 없습니다.",
    noProjectsHint: "상단의 + 버튼으로 첫 길드를 만들어 보세요.",
    notFound: "페이지를 찾을 수 없습니다.",
    goHome: "홈으로",
  },
  setup: {
    title: "길드 만들기",
    heading: "모험을 시작하세요",
    description: "첫 길드와 길드장 계정을 만듭니다.",
    guildName: "길드 이름",
    guildNamePlaceholder: "예: 달빛 모험가 길드",
    displayName: "모험가 이름",
    displayNamePlaceholder: "예: 김모험",
    loginId: "로그인 ID",
    loginIdPlaceholder: "3~32자 영문 소문자·숫자·. _ -",
    loginIdHint:
      "영문 소문자, 숫자, 점(.), 밑줄(_), 하이픈(-)만 사용할 수 있습니다.",
    password: "비밀번호",
    passwordPlaceholder: "8자 이상",
    passwordConfirm: "비밀번호 확인",
    submit: "길드 만들기",
    submitting: "길드를 만드는 중…",
    passwordMismatch: "비밀번호가 일치하지 않습니다.",
    failed: "길드를 만들지 못했습니다.",
  },
  login: {
    title: "로그인",
    heading: "다시 만났네요, 모험가님",
    description: "로그인 ID와 비밀번호를 입력하세요.",
    loginId: "로그인 ID",
    loginIdPlaceholder: "로그인 ID",
    password: "비밀번호",
    passwordPlaceholder: "비밀번호",
    submit: "입장하기",
    submitting: "입장하는 중…",
    invalidCredentials: "로그인 ID 또는 비밀번호가 올바르지 않습니다.",
    failed: "로그인하지 못했습니다.",
  },
  invite: {
    title: "길드 초대",
    heading: "길드에 초대받았습니다",
    description: "초대 링크로 길드에 참여합니다.",
    code: "초대 코드",
    projectName: "길드",
    loading: "초대 정보를 확인하는 중…",
    invalid: "유효하지 않거나 만료된 초대입니다.",
    joinTitle: "기존 모험가로 참여",
    joinDescription: "이미 계정이 있다면 로그인해 길드에 참여하세요.",
    join: "길드에 참여하기",
    joining: "참여하는 중…",
    joinFailed: "길드에 참여하지 못했습니다.",
    signupTitle: "새 모험가로 참여",
    signupDescription: "계정을 만들고 바로 길드에 합류하세요.",
    signup: "가입하고 참여하기",
    signingUp: "가입하는 중…",
    signupFailed: "가입하지 못했습니다.",
    displayName: "모험가 이름",
    displayNamePlaceholder: "예: 김모험",
    loginId: "로그인 ID",
    loginIdPlaceholder: "3~32자 영문 소문자·숫자·. _ -",
    password: "비밀번호",
    passwordPlaceholder: "8자 이상",
    passwordConfirm: "비밀번호 확인",
    passwordMismatch: "비밀번호가 일치하지 않습니다.",
    alreadyMember: "이미 참여 중인 길드입니다.",
    success: "길드에 참여했습니다!",
    loginLink: "로그인",
  },
  tabs: {
    board: "게시판",
    ledger: "원장",
    settings: "길드 설정",
    createGuild: "새 길드",
    createGuildTitle: "새 길드 만들기",
    createGuildDescription:
      "길드 이름을 정하면 바로 게시판으로 이동합니다.",
    guildName: "길드 이름",
    guildNamePlaceholder: "예: 달빛 모험가 길드",
    creating: "길드를 만드는 중…",
    createFailed: "길드를 만들지 못했습니다.",
    owner: "길드장",
    member: "길드원",
    logout: "로그아웃",
    loggingOut: "로그아웃 중…",
    level: (level: number): string => `Lv.${level}`,
    xp: (current: number, next: number): string =>
      `XP ${current.toLocaleString()} / ${next.toLocaleString()}`,
    xpLabel: "경험치",
    activeProject: "현재 길드",
    projectList: "길드 목록",
    viewToggle: "화면 전환",
    noProjects: "길드 없음",
  },
  board: {
    title: "게시판",
    columns: {
      board: "게시판",
      dungeon: "던전 진행",
      boss: "보스전",
      cleared: "클리어",
    },
    loading: "의뢰를 불러오는 중…",
    loadFailed: "의뢰를 불러오지 못했습니다.",
    emptyColumn: "아직 의뢰가 없습니다.",
    empty: "아직 등록된 의뢰가 없습니다.",
    newQuest: "새 의뢰",
    newQuestTitle: "의뢰 등록",
    quickAddPlaceholder: "의뢰 제목을 입력하고 Enter",
    createQuest: "의뢰 만들기",
    bulkPaste: "여러 의뢰 붙여넣기",
    searchPlaceholder: "의뢰 검색",
    filterByTag: "태그로 필터",
    allTags: "모든 태그",
    clearFilters: "필터 초기화",
    dropHere: "여기에 놓기",
    dragHint: "카드를 끌어 단계를 옮길 수 있습니다.",
    moveFailed: "의뢰를 옮기지 못했습니다.",
    questCount: (count: number): string => `${count}건`,
    bulk: {
      title: "여러 의뢰 등록",
      description:
        "한 줄에 하나씩 의뢰 제목을 붙여넣으세요. 빈 줄은 무시됩니다.",
      placeholder: "의뢰 제목 1\n의뢰 제목 2\n의뢰 제목 3",
      confirm: bulkConfirm,
      submit: "의뢰로 등록",
      submitting: "등록하는 중…",
      empty: "등록할 의뢰가 없습니다.",
      success: (count: number): string =>
        `${count}건의 의뢰를 등록했습니다.`,
      failed: "의뢰를 등록하지 못했습니다.",
    },
    drawer: {
      title: "의뢰 상세",
      situation: "현재 상황",
      direction: "수정 방향",
      dungeonView: "던전 뷰",
      dungeonComingSoon: "던전 뷰 준비 중",
      dungeonProgress: "던전 진행도",
      boss: "보스",
      floorRatio: (done: number, total: number): string => `${done}/${total}`,
      progressPercent: (percent: number): string => `${percent}%`,
      history: "모험 기록",
      keyEventsEmpty: "아직 큰 사건은 없습니다",
      showAllHistory: (count: number): string => `전체 기록 보기 (${count})`,
      archive: "의뢰 내리기",
      archiveConfirm: "이 의뢰를 내릴까요?",
      archived: "의뢰를 내렸습니다.",
      archiveFailed: "의뢰를 내리지 못했습니다.",
      refs: {
        title: "참고 문서",
        empty: "아직 참고 문서가 없습니다.",
        placeholder: "문서 URL 또는 경로",
        addLabel: "참고 문서 추가",
        copyPath: "경로 복사",
        remove: (target: string): string => `참고 문서 삭제: ${target}`,
        addFailed: "참고 문서를 추가하지 못했습니다.",
        removeFailed: "참고 문서를 삭제하지 못했습니다.",
      },
      checklist: {
        addLabel: "층 추가",
        addPlaceholder: "층 제목을 입력하고 Enter",
        addFailed: "층을 추가하지 못했습니다.",
        toggleFailed: "층을 저장하지 못했습니다.",
        conflict: "다른 사람이 먼저 바꿨습니다. 다시 확인해 주세요",
      },
      bossBattle: {
        waiting: "보스전 — 의뢰인의 확인을 기다리는 중",
        clear: "던전 클리어 선언",
        retry: "재도전 요청",
        retryTitle: "재도전 요청",
        retryDescription:
          "의뢰인에게 재도전을 요청합니다. 사유는 필수입니다.",
        retryCommentLabel: "재도전 사유",
        retryCommentPlaceholder:
          "다시 도전해야 하는 이유를 적어 주세요 (최대 500자)",
        retrySubmit: "재도전 요청 보내기",
        retrySubmitting: "보내는 중…",
        retryFailed: "재도전을 요청하지 못했습니다.",
      },
      clear: {
        action: "클리어 선언",
        working: "선언하는 중…",
        failed: "클리어를 선언하지 못했습니다.",
        celebrationTitle: "던전 클리어!",
        reward: (amount: number): string =>
          `+${amount.toLocaleString("ko-KR")} XP`,
      },
    },
  },
  quest: {
    title: "의뢰",
    editTitle: "의뢰 수정",
    detailTitle: "의뢰 상세",
    number: "번호",
    titleLabel: "제목",
    titlePlaceholder: "무엇을 해결해야 하나요?",
    kindLabel: "종류",
    kinds: {
      fix: "수정",
      feature: "신규",
    },
    kindFields: {
      fix: {
        situation: "현재 상황",
        direction: "수정 방향",
        situationPlaceholder: "어디서 무엇이 어떻게 보이는지",
        directionPlaceholder:
          "어떻게 바뀌어야 하는지 (- [ ] 로 시작하는 줄은 층)",
        emptySituation: "현재 상황이 아직 없습니다.",
        emptyDirection: "수정 방향이 아직 없습니다.",
      },
      feature: {
        situation: "요약",
        direction: "구현 내용",
        situationPlaceholder: "한두 줄 요약",
        directionPlaceholder: "구현할 내용 (- [ ] 로 시작하는 줄은 층)",
        emptySituation: "요약이 아직 없습니다.",
        emptyDirection: "구현 내용이 아직 없습니다.",
      },
    },
    situation: "현재 상황",
    situationPlaceholder: "지금 어떤 상황인가요?",
    direction: "수정 방향",
    directionPlaceholder: "어떤 방향으로 해결할까요?",
    tags: "태그",
    tagsPlaceholder: "태그를 입력하고 Enter",
    tagAdd: "태그 추가",
    tagRemove: (tag: string): string => `${tag} 태그 삭제`,
    stage: "단계",
    party: "파티",
    partyLeader: "파티장",
    emptyParty: "빈 파티",
    memberStatuses: MEMBER_STATUS_LABELS,
    floors: "층",
    bounty: "현상금",
    bountyMultiplier: (multiplier: number): string => `×${multiplier}`,
    pendingNominations: "지목 대기",
    dusty: "먼지 쌓인 의뢰",
    createdBy: "작성자",
    createdAt: "등록일",
    updatedAt: "수정일",
    save: "의뢰 저장",
    saving: "저장 중…",
    create: "의뢰 등록",
    creating: "등록 중…",
    created: "의뢰를 등록했습니다.",
    updated: "의뢰를 수정했습니다.",
    createFailed: "의뢰를 등록하지 못했습니다.",
    updateFailed: "의뢰를 수정하지 못했습니다.",
    loadFailed: "의뢰를 불러오지 못했습니다.",
    tagsFailed: "태그를 불러오지 못했습니다.",
    noTags: "태그 없음",
    untitled: "제목 없는 의뢰",
    noDescription: "설명 없음",
    projectLabel: (projectId: number | string): string =>
      `길드 #${projectId}`,
    stages: {
      rumor: "소문",
      board: "게시판",
      dungeon: "던전 진행",
      boss: "보스전",
      cleared: "클리어",
      archived: "아카이브",
    },
  },
  ledger: {
    title: "의뢰 원장",
    heading: "모험 기록장",
    description: "길드의 모든 의뢰를 한눈에 봅니다.",
    loading: "원장을 불러오는 중…",
    loadFailed: "원장을 불러오지 못했습니다.",
    empty: "아직 기록된 의뢰가 없습니다.",
    columns: {
      number: "번호",
      title: "제목",
      kind: "종류",
      tags: "태그",
      party: "파티",
      bounty: "현상금",
      floors: "층",
      stage: "단계",
      createdBy: "작성자",
      createdAt: "등록일",
      updatedAt: "수정일",
    },
    sortHint: "열 제목을 눌러 정렬할 수 있습니다.",
    sortBy: (label: string): string => `${label} 기준 정렬`,
    exportCsv: "CSV로 내보내기",
    noTags: "태그 없음",
  },
  settings: {
    title: "길드 설정",
    heading: "길드 관리",
    description: "길드 정보와 모험가를 관리합니다.",
    projectLabel: (projectId: number | string): string =>
      `길드 #${projectId}`,
    guildName: "길드 이름",
    guildNamePlaceholder: "길드 이름",
    saveGuildName: "길드 이름 저장",
    saving: "저장 중…",
    saved: "저장했습니다.",
    saveFailed: "저장하지 못했습니다.",
    loadFailed: "길드 정보를 불러오지 못했습니다.",
    members: "모험가",
    membersDescription: "이 길드에 함께하는 모험가 목록입니다.",
    memberCount: (count: number): string => `${count}명`,
    roleOwner: "길드장",
    roleMember: "길드원",
    invites: "초대 링크",
    invitesDescription: "초대 링크를 공유해 새 모험가를 부르세요.",
    invitesLoadFailed: "초대 목록을 불러오지 못했습니다.",
    createInvite: "초대 링크 만들기",
    creatingInvite: "초대 링크를 만드는 중…",
    inviteCreateFailed: "초대 링크를 만들지 못했습니다.",
    inviteUrl: "초대 링크",
    copyInvite: "링크 복사",
    copied: "복사했습니다.",
    copyFailed: "복사하지 못했습니다.",
    revokeInvite: "초대 취소",
    revokingInvite: "취소하는 중…",
    revokeConfirm: "이 초대 링크를 취소할까요?",
    revokeFailed: "초대를 취소하지 못했습니다.",
    active: "활성",
    revoked: "취소됨",
    inviteEmpty: "아직 만든 초대 링크가 없습니다.",
    createdBy: (name: string): string => `${name}님이 만든 초대`,
    createdAt: "생성일",
    dangerZone: "위험 구역",
    leaveGuild: "길드 떠나기",
    leaveConfirm: "정말 길드를 떠날까요?",
    leaveFailed: "길드를 떠나지 못했습니다.",
  },
  notifications: {
    label: "알림",
    title: "알림",
    loading: "알림을 불러오는 중…",
    loadFailed: "알림을 불러오지 못했습니다.",
    empty: "새 알림이 없습니다.",
    markAllRead: "모두 읽음",
    markAllReadFailed: "알림을 읽음으로 표시하지 못했습니다.",
    accept: "수락",
    accepting: "수락 중…",
    acceptFailed: "지목을 수락하지 못했습니다.",
    pass: "패스",
    unknownActor: NOTIFICATION_UNKNOWN_ACTOR,
    questFallback: NOTIFICATION_QUEST_FALLBACK,
    questLabel: notificationQuestLabel,
    templates: notificationTemplates,
    format: formatNotification,
  },
  pass: {
    title: "지목 넘기기",
    description: "이번 지목을 넘기고, 필요하면 다른 모험가에게 토스하세요.",
    reasonLabel: "넘기는 이유",
    reasonPlaceholder: "이유를 직접 입력 (최대 100자)",
    presetsLabel: "빠른 선택",
    tossLabel: "토스할 모험가",
    tossNone: "토스하지 않음",
    membersLoadFailed: "모험가 목록을 불러오지 못했습니다.",
    submit: "패스하기",
    submitting: "넘기는 중…",
    failed: "지목을 넘기지 못했습니다.",
  },
  party: {
    title: "파티",
    activeList: "참여 중인 모험가",
    empty: "아직 파티가 없습니다.",
    statusChip: "공략 상태",
    retreated: "후퇴한 모험가",
    retreatReason: (reason: string): string => `사유: ${reason}`,
    noRetreatReason: "사유 없음",
    nominationLabel: "지목",
    nominatedBy: (name: string): string => `${name}님이 지목`,
    nominationList: "지목 대기",
    cancelNomination: "지목 취소",
    accept: "수락",
    accepting: "수락 중…",
    pass: "패스",
    join: "참여",
    joining: "참여 중…",
    leave: "후퇴",
    leaving: "후퇴하는 중…",
    leaveTitle: "후퇴",
    leaveDescription: "파티에서 후퇴합니다. 사유는 선택 사항입니다.",
    leaveReasonLabel: "후퇴 사유",
    leaveReasonPlaceholder: "이유를 남겨 주세요 (최대 100자)",
    leaveConfirm: "후퇴하기",
    nominate: "지목",
    nominateTitle: "지목할 모험가",
    nominateSubmit: "지목 보내기",
    reinforce: "증원 요청",
    reinforceTitle: "증원 요청할 모험가",
    reinforceSubmit: "증원 요청 보내기",
    submitting: "보내는 중…",
    membersLoadFailed: "길드원 목록을 불러오지 못했습니다.",
    noCandidates: "지목할 수 있는 길드원이 없습니다.",
    errors: {
      forbidden: "이 작업을 할 권한이 없습니다.",
      conflict: "이미 처리되었거나 지금은 바꿀 수 없는 상태입니다.",
      failed: "파티 작업을 처리하지 못했습니다.",
    },
  },
  levelUp: {
    title: "LEVEL UP!",
    level: (from: number, to: number): string => `Lv.${from} → Lv.${to}`,
    hint: "새로운 레벨에 도달했습니다.",
  },
  theme: {
    label: "테마",
    system: "시스템",
    light: "라이트",
    dark: "다크",
  },
  errors: {
    generic: "문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
    network: "서버와 연결할 수 없습니다. 네트워크를 확인해 주세요.",
    unauthorized: "로그인이 필요합니다.",
    forbidden: "이 작업을 할 권한이 없습니다.",
    notFound: "요청한 정보를 찾을 수 없습니다.",
    validation: "입력값을 확인해 주세요.",
    conflict: "이미 존재하는 정보입니다.",
    setupRequired: "먼저 길드를 만들어 주세요.",
    unknown: "알 수 없는 오류가 발생했습니다.",
    loadFailed: "정보를 불러오지 못했습니다.",
    saveFailed: "저장하지 못했습니다.",
    deleteFailed: "삭제하지 못했습니다.",
    retryHint: "잠시 후 다시 시도해 주세요.",
    http: (status: number): string =>
      `요청에 실패했습니다 (HTTP ${status}).`,
    /** Server error codes mapped to Korean copy. */
    byCode: {
      unauthorized: "로그인이 필요합니다.",
      forbidden: "이 작업을 할 권한이 없습니다.",
      not_found: "요청한 정보를 찾을 수 없습니다.",
      validation_error: "입력값을 확인해 주세요.",
      setup_required: "먼저 길드를 만들어 주세요.",
      conflict: "이미 존재하는 정보입니다.",
      invalid_credentials: "로그인 ID 또는 비밀번호가 올바르지 않습니다.",
      invite_invalid: "유효하지 않거나 만료된 초대입니다.",
      login_id_taken: "이미 사용 중인 로그인 ID입니다.",
    } as Record<string, string>,
  },
  time: timeStrings,
} as const;

/** Shape of the Korean copy bundle. */
export type Ko = typeof ko;

export default ko;
