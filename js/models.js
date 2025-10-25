/**
 * 데이터 모델 클래스들
 * 프로그램 전반에서 사용되는 데이터 구조를 캡슐화합니다
 */

import { SEARCH_CONSTANTS } from './constants.js';

/**
 * 검색 컨텍스트 (의존성 주입용)
 */
export class SearchContext {
    constructor(api, rankingCache) {
        this.api = api;
        this.rankingCache = rankingCache;
    }
}

/**
 * FFLogs Report 데이터
 */
export class Report {
    constructor(data, code) {
        this.code = code;
        this.startTime = data.startTime;
        this.endTime = data.endTime;
        this.zone = data.zone;
        this.fights = data.fights;
        this.rankings = data.rankings;
        this._rawData = data;
    }

    /**
     * Region 감지
     */
    getRegion() {
        if (this.rankings && this.rankings.data && this.rankings.data.length > 0) {
            const rankingData = this.rankings.data[0];
            // roles 안의 첫 번째 캐릭터에서 region 추출
            for (const roleKey in rankingData.roles || {}) {
                const role = rankingData.roles[roleKey];
                if (role.characters && role.characters.length > 0) {
                    const firstChar = role.characters[0];
                    if (firstChar.server && firstChar.server.region) {
                        return firstChar.server.region;
                    }
                }
            }
        }
        return null;
    }

    /**
     * Partition 감지
     */
    getPartition(region) {
        if (this.rankings && this.rankings.data && this.rankings.data.length > 0) {
            return this.rankings.data[0].partition;
        }

        // 한국 서버는 기본 파티션
        if (region === 'KR') {
            return SEARCH_CONSTANTS.KR_PARTITION;
        }

        // 파티션 정보가 없는 경우 zone에서 기본값 찾기
        if (this.zone?.partitions) {
            const defaultPartition = this.zone.partitions.find(p => p.default);
            return defaultPartition?.id || SEARCH_CONSTANTS.DEFAULT_PARTITION;
        }

        return null;
    }

    /**
     * Fight 필터링 및 준비
     */
    filterFights(fightId = null) {
        let allFights = this.fights.filter(f => f.encounterID > 0); // 모든 보스 전투

        // 'last' 처리
        if (fightId === 'last') {
            if (allFights.length > 0) {
                const lastFight = allFights[allFights.length - 1];
                return {
                    fights: [lastFight],
                    specifiedFightId: lastFight.id,
                    allFights: allFights
                };
            }
            throw new Error('보스 전투를 찾을 수 없습니다.');
        }

        if (fightId !== null && fightId !== undefined) {
            // 특정 Fight ID가 지정된 경우
            const specifiedFight = allFights.find(f => f.id === parseInt(fightId));
            if (specifiedFight) {
                return {
                    fights: [specifiedFight],
                    specifiedFightId: specifiedFight.id,
                    allFights: allFights
                };
            }
            throw new Error(`전투 ID ${fightId}를 찾을 수 없습니다.`);
        }

        // Fight ID가 없으면 모든 보스 전투
        return {
            fights: allFights,
            specifiedFightId: null,
            allFights: allFights
        };
    }

    /**
     * 첫 번째 보스 전투 반환
     */
    getFirstFight() {
        const allFights = this.fights.filter(f => f.encounterID > 0);
        return allFights.length > 0 ? allFights[0] : null;
    }
}

/**
 * Encounter 조회 파라미터
 */
export class EncounterQuery {
    constructor(encounterId, difficulty, size, region, partition, partitionName = null) {
        this.encounterId = encounterId;
        this.difficulty = difficulty;
        this.size = size;
        this.region = region;
        this.partition = partition;
        this.partitionName = partitionName;
    }

    /**
     * Fight에서 EncounterQuery 생성
     */
    static fromFight(fight, region, partition, partitionName = null) {
        return new EncounterQuery(
            fight.encounterID,
            fight.difficulty,
            fight.size,
            region,
            partition,
            partitionName
        );
    }

    /**
     * lastSearchParams 형식과 호환
     */
    toSearchParams(reportStartTime) {
        return {
            encounterId: this.encounterId,
            difficulty: this.difficulty,
            size: this.size,
            region: this.region,
            partition: this.partition,
            reportStartTime: reportStartTime
        };
    }
}

/**
 * Ranking 데이터 (선택적, 필요시 확장)
 */
export class Ranking {
    constructor(data) {
        this.name = data.name;
        this.startTime = data.startTime;
        this.duration = data.duration;
        this.spec = data.spec;
        this.amount = data.amount; // RDPS
        this.server = data.server ? {
            name: data.server.name,
            region: data.server.region
        } : null;
        this.report = data.report ? {
            code: data.report.code,
            fightID: data.report.fightID
        } : null;
    }
}
