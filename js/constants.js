// ===== 상수 정의 =====
export const STORAGE_KEYS = {
    CLIENT_ID: 'fflogs_client_id',
    CLIENT_SECRET: 'fflogs_client_secret',
    REGION: 'fflogs_region',
    SEARCH_ALL_FIGHTS: 'fflogs_search_all_fights'
};

export const SEARCH_CONSTANTS = {
    MAX_PAGES: 1600,
    KR_PARTITION: 5,
    DEFAULT_PARTITION: 1,
    MAX_BATCH_SIZE: 30,       // 한번에 요청할 최대 페이지 수
    MAX_RETRIES: 2            // 배치 요청 실패 시 최대 재시도 횟수
};

export const RATE_LIMIT_CONSTANTS = {
    WINDOW_MS: 120000,        // Rate limit 추적 윈도우 (밀리초)
    MAX_REQUESTS: 240,        // 윈도우 시간당 최대 요청 수
    SAFETY_MARGIN_MS: 1000,   // 대기 시간 안전 여유 (밀리초)
    POINTS_PER_REQUEST: 1.1   // 요청당 예상 포인트 소모량
};

export const MATCHING_THRESHOLDS = {
    TIME_DIFF_MS: 10000,      // 10초
    DURATION_DIFF_MS: 5000,   // 5초
    RDPS_DIFF_RATIO: 0.001    // 0.1% (RDPS 검증 시 허용 오차)
};

export const CACHE_CONSTANTS = {
    CLEANUP_THRESHOLD_MS: 60000  // 1분 (비정상 종료 판단 기준)
};

export const ANONYMOUS_NAMES = ['Anonymous', 'anonymous'];

// 직업명 영문->한글 변환 맵
export const jobNameMap = {
    // Tank
    'Paladin': '나이트',
    'Warrior': '전사',
    'DarkKnight': '암흑기사',
    'Gunbreaker': '건브레이커',

    // Healer
    'WhiteMage': '백마도사',
    'Scholar': '학자',
    'Astrologian': '점성술사',
    'Sage': '현자',

    // Melee DPS
    'Monk': '몽크',
    'Dragoon': '용기사',
    'Ninja': '닌자',
    'Samurai': '사무라이',
    'Reaper': '리퍼',
    'Viper': '바이퍼',

    // Ranged Physical DPS
    'Bard': '음유시인',
    'Machinist': '기공사',
    'Dancer': '무도가',

    // Ranged Magical DPS
    'BlackMage': '흑마도사',
    'Summoner': '소환사',
    'RedMage': '적마도사',
    'Pictomancer': '픽토맨서',
    'BlueMage': '청마도사',

    // LimitBreak
    'LimitBreak': '리미트 브레이크',
    'Unknown': '알 수 없음'
};

// 서버명 영문->한글 변환 맵 (한국 서버만)
export const serverNameMap = {
    'Carbuncle': '카벙클',
    'Chocobo': '초코보',
    'Moogle': '모그리',
    'Tonberry': '톤베리',
    'Fenrir': '펜리르'
};
