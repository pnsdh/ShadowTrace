// ===== 상수 정의 =====
export const STORAGE_KEYS = {
    CLIENT_ID: 'fflogs_client_id',
    CLIENT_SECRET: 'fflogs_client_secret',
    REGION: 'fflogs_region',
    RANKING_CACHE: 'fflogs_ranking_cache',
    SEARCH_ALL_FIGHTS: 'fflogs_search_all_fights'
};

export const SEARCH_CONSTANTS = {
    MAX_PAGES: 1600,
    KR_PARTITION: 5,
    DEFAULT_PARTITION: 1
};

export const MATCHING_THRESHOLDS = {
    TIME_DIFF_MS: 10000,      // 10초
    DURATION_DIFF_MS: 5000    // 5초
};

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

// 헬퍼 함수
export function translateJobName(englishName) {
    return jobNameMap[englishName] || englishName;
}

export function translateServerName(englishName, region) {
    // KR 지역일 때만 서버명 번역, 그 외에는 원본 그대로
    if (region === 'KR') {
        return serverNameMap[englishName] || englishName;
    }
    return englishName;
}

export function getJobOrder(jobName) {
    const jobKeys = Object.keys(jobNameMap);
    const index = jobKeys.indexOf(jobName);
    return index !== -1 ? index : 999;
}
