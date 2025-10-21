import { MATCHING_THRESHOLDS } from './constants.js';

// ===== 매칭 알고리즘 =====
export class LogMatcher {
    constructor(anonymousFight, reportStartTime, anonymousReportCode) {
        this.anonymousFight = anonymousFight;
        this.reportStartTime = reportStartTime;
        this.anonymousReportCode = anonymousReportCode;
        this.anonymousFightID = anonymousFight.id;
        this.absoluteStartTime = reportStartTime + anonymousFight.startTime;
        this.duration = anonymousFight.endTime - anonymousFight.startTime;
    }

    match(ranking) {
        // 랭킹의 절대 시작 시간 계산
        const rankingAbsoluteTime = ranking.startTime;

        // 시간 차이 (밀리초)
        const timeDiff = Math.abs(rankingAbsoluteTime - this.absoluteStartTime);

        // Duration 차이 (밀리초)
        const durationDiff = Math.abs(ranking.duration - this.duration);

        // 매칭 기준: 설정된 임계값 이내
        const timeMatch = timeDiff < MATCHING_THRESHOLDS.DURATION_DIFF_MS;
        const durationMatch = durationDiff < MATCHING_THRESHOLDS.TIME_DIFF_MS;

        if (timeMatch && durationMatch) {
            return {
                matched: true,
                timeDiff,
                durationDiff,
                ranking
            };
        }

        return { matched: false };
    }

    // RDPS 검증: 익명 로그와 공개 로그의 전체 파티원 RDPS 비교
    async verifyRDPS(reportCode, fightID, api, signal = null) {
        try {
            // 익명 로그의 RDPS 데이터 가져오기
            const anonymousRDPS = await api.getReportRDPS(this.anonymousReportCode, this.anonymousFightID, signal);

            if (!anonymousRDPS || anonymousRDPS.length === 0) {
                return false;
            }

            // 공개 로그의 RDPS 데이터 가져오기
            const publicRDPS = await api.getReportRDPS(reportCode, fightID, signal);

            if (!publicRDPS || publicRDPS.length === 0) {
                return false;
            }

            // 익명 로그의 RDPS를 정렬 (값만)
            const anonymousRDPSValues = anonymousRDPS.map(r => r.amount).sort((a, b) => b - a);

            // 공개 로그의 RDPS를 정렬 (값만)
            const publicRDPSValues = publicRDPS.map(r => r.amount).sort((a, b) => b - a);

            // RDPS 개수가 다르면 불일치
            if (anonymousRDPSValues.length !== publicRDPSValues.length) {
                return false;
            }

            // 각 RDPS 값이 일치하는지 확인 (소수점 차이 허용)
            for (let i = 0; i < anonymousRDPSValues.length; i++) {
                const diff = Math.abs(anonymousRDPSValues[i] - publicRDPSValues[i]);
                if (diff / anonymousRDPSValues[i] > MATCHING_THRESHOLDS.RDPS_DIFF_RATIO) {
                    return false;
                }
            }

            return true;
        } catch (e) {
            console.warn('RDPS 검증 실패:', e);
            return false;
        }
    }
}
