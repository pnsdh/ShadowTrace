
// ===== 캐시 관리 (IndexedDB) =====
export class RankingCache {
    constructor() {
        this.initialized = false;
        this.searchStartTime = null; // 현재 검색 시작 시간
        this.keysAddedInCurrentSearch = new Set(); // 현재 검색에서 추가된 키

        // localForage 설정
        this.storage = localforage.createInstance({
            name: 'ShadowTrace',
            storeName: 'rankingCache'
        });
    }

    async init() {
        if (this.initialized) return;

        try {
            // 불완전한 검색 캐시 정리 (이전 세션에서 중단된 경우)
            await this.cleanupIncompleteSearches();

            this.initialized = true;
        } catch (e) {
            console.error('캐시 초기화 실패:', e);
            this.initialized = true;
        }
    }

    getCacheKey(encounterId, difficulty, size, region, page, partition) {
        return `${encounterId}_${difficulty}_${size}_${region}_${page}_${partition || 'default'}`;
    }

    async get(encounterId, difficulty, size, region, page, partition) {
        const key = this.getCacheKey(encounterId, difficulty, size, region, page, partition);
        const cached = await this.storage.getItem(key);
        if (!cached) return null;

        // 캐시된 최소 데이터를 원래 형태로 복원
        return {
            data: {
                rankings: cached.rankings,
                hasMorePages: cached.hasMorePages,
                encounterName: cached.encounterName
            }
        };
    }

    // 특정 fight의 캐시 존재 여부 확인
    async hasCacheForFight(encounterId, difficulty, size, region, partition) {
        const keys = await this.storage.keys();
        const prefix = `${encounterId}_${difficulty}_${size}_${region || ''}_`;
        const partitionSuffix = `_${partition || 'default'}`;

        return keys.some(key => key.startsWith(prefix) && key.endsWith(partitionSuffix));
    }

    // 캐시된 최대 페이지 수 확인 (완전한 캐시인 경우)
    async getCachedMaxPage(encounterId, difficulty, size, region, partition) {
        const keys = await this.storage.keys();
        const prefix = `${encounterId}_${difficulty}_${size}_${region || ''}_`;
        const partitionSuffix = `_${partition || 'default'}`;

        let maxPage = 0;
        let hasDefinitiveEnd = false;

        // 모든 매칭 키에서 페이지 번호 찾기
        for (const key of keys) {
            if (key.startsWith(prefix) && key.endsWith(partitionSuffix)) {
                const item = await this.storage.getItem(key);
                if (item) {
                    // 페이지 번호 추출
                    const parts = key.split('_');
                    const page = parseInt(parts[parts.length - 2]);
                    if (page > maxPage) {
                        maxPage = page;
                    }

                    // hasMorePages: false인 페이지를 발견하면 확정적인 끝
                    if (item.hasMorePages === false) {
                        hasDefinitiveEnd = true;
                    }
                }
            }
        }

        // 캐시된 페이지가 있으면 반환 (hasMorePages와 무관하게)
        return maxPage > 0 ? maxPage : null;
    }

    async set(encounterId, difficulty, size, region, page, partition, data, encounterName) {
        // 빈 랭킹 데이터는 저장하지 않음 (이진 탐색 시 빈 페이지 방지)
        if (!data.rankings || !Array.isArray(data.rankings) || data.rankings.length === 0) {
            return;
        }

        const key = this.getCacheKey(encounterId, difficulty, size, region, page, partition);

        // 필수 데이터만 추출하여 저장 (용량 최소화)
        const minimalRankings = [];
        data.rankings.forEach(ranking => {
            // 매칭에 필요한 최소한의 데이터만 저장
            minimalRankings.push({
                name: ranking.name,
                startTime: ranking.startTime,
                duration: ranking.duration,
                spec: ranking.spec,
                amount: ranking.amount, // RDPS
                server: ranking.server ? {
                    name: ranking.server.name,
                    region: ranking.server.region
                } : null,
                report: ranking.report ? {
                    code: ranking.report.code,
                    fightID: ranking.report.fightID
                } : null
            });
        });

        const cacheData = {
            rankings: minimalRankings,
            hasMorePages: data.hasMorePages,
            encounterName: encounterName || data.encounterName || `Encounter ${encounterId}`,
            timestamp: Date.now(),
            encounterId: encounterId,
            region: region,
            partition: partition,
            partitionName: data.partitionName || null  // API에서 받은 파티션 이름
        };

        // 현재 검색 중에 추가된 키 기록
        if (this.searchStartTime !== null) {
            this.keysAddedInCurrentSearch.add(key);
        }

        // 개별 키로 즉시 저장
        await this.storage.setItem(key, cacheData);
    }

    // 검색 시작
    startSearch() {
        this.searchStartTime = Date.now();
        this.keysAddedInCurrentSearch.clear();

        // 검색 시작 시간을 localStorage에 기록 (창 닫힘 대비)
        localStorage.setItem('search_in_progress', this.searchStartTime.toString());
    }

    // 검색 완료 (정상 종료)
    finishSearch() {
        this.searchStartTime = null;
        this.keysAddedInCurrentSearch.clear();

        // 검색 완료 표시 제거
        localStorage.removeItem('search_in_progress');
    }

    // 검색 중단 (불완전한 캐시 삭제)
    async abortSearch() {
        if (this.searchStartTime === null) return;

        // 현재 검색에서 추가된 키들을 모두 삭제
        for (const key of this.keysAddedInCurrentSearch) {
            await this.storage.removeItem(key);
        }

        this.searchStartTime = null;
        this.keysAddedInCurrentSearch.clear();

        // 검색 완료 표시 제거
        localStorage.removeItem('search_in_progress');
    }

    // 불완전한 검색 캐시 정리 (페이지 로드 시 호출)
    async cleanupIncompleteSearches() {
        const searchInProgress = localStorage.getItem('search_in_progress');

        if (!searchInProgress) {
            return; // 이전에 중단된 검색 없음
        }

        const searchStartTime = parseInt(searchInProgress);
        const now = Date.now();

        // 1분 이상 지난 "검색 중" 상태는 비정상 종료로 간주
        if (now - searchStartTime < 60000) {
            return; // 최근 검색이므로 유지
        }

        console.log('이전 세션의 불완전한 캐시를 정리합니다...');

        // 검색 시작 시간 이후에 저장된 캐시 삭제
        const keys = await this.storage.keys();
        let deletedCount = 0;

        for (const key of keys) {
            const item = await this.storage.getItem(key);
            if (item && item.timestamp >= searchStartTime) {
                await this.storage.removeItem(key);
                deletedCount++;
            }
        }

        if (deletedCount > 0) {
            console.log(`불완전한 캐시 ${deletedCount}개를 삭제했습니다.`);
        }

        // 검색 완료 표시 제거
        localStorage.removeItem('search_in_progress');
    }

    async getCacheInfoByEncounter() {
        const encounterData = {};
        const keys = await this.storage.keys();

        for (const key of keys) {
            const item = await this.storage.getItem(key);
            if (!item) continue;

            const encounterId = item.encounterId || 'Unknown';
            const encounterName = item.encounterName || `Encounter ${encounterId}`;
            const region = item.region || '';
            const partition = item.partition || 'default';

            // displayKey는 파티션 번호로만 그룹화 (이름 상관없이)
            const displayKey = `${encounterId}_${region}_${partition}`;

            if (!encounterData[displayKey]) {
                encounterData[displayKey] = {
                    count: 0,
                    timestamps: [],
                    encounterId: encounterId,
                    encounterName: encounterName,
                    region: region,
                    partition: partition,
                    sizeBytes: 0,
                    partitionName: null  // 가장 최신 partitionName 저장
                };
            }

            encounterData[displayKey].count++;
            encounterData[displayKey].timestamps.push(item.timestamp);

            // 파티션 이름이 있으면 업데이트 (최신 것 우선)
            if (item.partitionName && !encounterData[displayKey].partitionName) {
                encounterData[displayKey].partitionName = item.partitionName;
            }

            // 캐시 항목 크기 계산 (JSON 문자열 길이로 근사)
            encounterData[displayKey].sizeBytes += JSON.stringify(item).length;
        }

        // 각 보스별 최신 시간 및 용량 계산
        Object.keys(encounterData).forEach(key => {
            const timestamps = encounterData[key].timestamps;
            encounterData[key].latest = Math.max(...timestamps);
            encounterData[key].oldest = Math.min(...timestamps);

            // 사람이 읽기 쉬운 용량 형식
            const bytes = encounterData[key].sizeBytes;
            if (bytes < 1024) {
                encounterData[key].sizeFormatted = `${bytes}B`;
            } else if (bytes < 1024 * 1024) {
                encounterData[key].sizeFormatted = `${(bytes / 1024).toFixed(1)}KB`;
            } else {
                encounterData[key].sizeFormatted = `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
            }
        });

        return encounterData;
    }

    async clearEncounter(encounterId, region, partition) {
        const keys = await this.storage.keys();
        const keysToDelete = [];

        for (const key of keys) {
            const item = await this.storage.getItem(key);
            if (!item) continue;

            const matchesEncounter = item.encounterId === encounterId;
            const matchesRegion = !region || item.region === region;

            // partition 매칭: 'default' 문자열도 처리
            const itemPartition = item.partition || 'default';
            const targetPartition = partition || 'default';
            const matchesPartition = itemPartition === targetPartition;

            if (matchesEncounter && matchesRegion && matchesPartition) {
                keysToDelete.push(key);
            }
        }

        for (const key of keysToDelete) {
            await this.storage.removeItem(key);
        }
    }

    async clear() {
        await this.storage.clear();
    }

    // 캐시 내보내기 (JSON 파일)
    async exportCache() {
        const keys = await this.storage.keys();
        const exportData = [];

        for (const key of keys) {
            const item = await this.storage.getItem(key);
            if (item) {
                exportData.push({
                    key: key,
                    data: item
                });
            }
        }

        return exportData;
    }

    // 캐시 가져오기 (timestamp 비교하여 최신 데이터만)
    async importCache(importData) {
        let importedCount = 0;
        let skippedCount = 0;
        const importedItemsMap = new Map(); // key: displayKey, value: true
        const skippedItemsMap = new Map();

        for (const entry of importData) {
            const existingItem = await this.storage.getItem(entry.key);

            // 표시용 이름 생성 (encounterName, region, partition)
            const encounterName = entry.data.encounterName || 'Unknown';
            const region = entry.data.region || '';
            const partition = entry.data.partition || 'default';
            const partitionNum = partition === 'default' ? null : partition;

            let partitionDisplay;
            if (entry.data.partitionName) {
                partitionDisplay = `P${partitionNum} - ${entry.data.partitionName}`;
            } else if (partitionNum) {
                partitionDisplay = `P${partitionNum}`;
            } else {
                partitionDisplay = 'P?';
            }

            const displayKey = `${encounterName}, ${region}, ${partitionDisplay}`;

            // 기존 데이터가 없거나, 새 데이터가 더 최신이면 덮어쓰기
            if (!existingItem || (entry.data.timestamp > existingItem.timestamp)) {
                await this.storage.setItem(entry.key, entry.data);
                importedCount++;
                importedItemsMap.set(displayKey, true);
            } else {
                skippedCount++;
                skippedItemsMap.set(displayKey, true);
            }
        }

        return {
            importedCount,
            skippedCount,
            totalCount: importData.length,
            details: {
                imported: Array.from(importedItemsMap.keys()),
                skipped: Array.from(skippedItemsMap.keys())
            }
        };
    }

    // 특정 fight의 모든 캐시된 플레이어 이름 가져오기
    async getAllCachedPlayers(encounterId, difficulty, size, region, partition) {
        const keys = await this.storage.keys();
        const prefix = `${encounterId}_${difficulty}_${size}_${region || ''}_`;
        const partitionSuffix = `_${partition || 'default'}`;
        const playerNames = new Set();

        for (const key of keys) {
            if (key.startsWith(prefix) && key.endsWith(partitionSuffix)) {
                const item = await this.storage.getItem(key);
                if (item && item.rankings && Array.isArray(item.rankings)) {
                    item.rankings.forEach(ranking => {
                        if (ranking && ranking.name && ranking.name !== 'Anonymous' && ranking.name !== 'anonymous') {
                            playerNames.add(ranking.name);
                        }
                    });
                }
            }
        }

        return playerNames;
    }

    // 특정 파티션의 캐시 timestamp 조회 (첫 번째 캐시 항목 사용)
    async getLatestCacheTimestamp(encounterId, difficulty, size, region, partition) {
        const keys = await this.storage.keys();
        const prefix = `${encounterId}_${difficulty}_${size}_${region || ''}_`;
        const partitionSuffix = `_${partition || 'default'}`;

        for (const key of keys) {
            if (key.startsWith(prefix) && key.endsWith(partitionSuffix)) {
                const item = await this.storage.getItem(key);
                if (item && item.timestamp) {
                    // 첫 번째로 찾은 캐시의 timestamp 반환 (같은 검색 세션의 캐시는 동일한 시점)
                    return item.timestamp;
                }
            }
        }

        return null;
    }
}
