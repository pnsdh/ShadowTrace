import { showError, updateCacheDisplay } from './ui.js';
import { showConfirm } from './modal.js';

/**
 * 캐시 관리 모듈
 * 캐시 삭제, 업데이트 후 재검색, 내보내기/가져오기 등을 담당합니다
 */

/**
 * 특정 encounter의 캐시를 삭제합니다
 * @param {RankingCache} rankingCache - 랭킹 캐시 인스턴스
 * @param {number} encounterId - Encounter ID
 * @param {string} region - 지역 (KR, NA, EU 등)
 * @param {number} partition - 파티션 번호
 */
export async function clearEncounterCache(rankingCache, encounterId, region, partition) {
    if (!encounterId || encounterId === 'Unknown') {
        showError('유효하지 않은 캐시입니다.');
        return;
    }

    const partitionText = partition ? ` (Partition ${partition})` : '';
    const confirmed = await showConfirm('캐시 삭제', `이 보스의 캐시를 삭제하시겠습니까?${partitionText}`);

    if (confirmed) {
        await rankingCache.clearEncounter(encounterId, region, partition);
        await updateCacheDisplay(rankingCache);
    }
}

/**
 * 모든 캐시를 삭제합니다
 * @param {RankingCache} rankingCache - 랭킹 캐시 인스턴스
 */
export async function clearAllCache(rankingCache) {
    const confirmed = await showConfirm(
        '전체 캐시 삭제',
        '모든 캐시 데이터를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.'
    );

    if (confirmed) {
        await rankingCache.clear();
        await updateCacheDisplay(rankingCache);
    }
}

/**
 * 캐시를 업데이트하고 재검색합니다
 * @param {RankingCache} rankingCache - 랭킹 캐시 인스턴스
 * @param {Object} lastSearchParams - 마지막 검색 파라미터
 * @param {Function} startSearchFn - 검색 시작 함수
 */
export async function refreshCacheAndSearch(rankingCache, lastSearchParams, startSearchFn) {
    if (!lastSearchParams) {
        showError('저장된 검색 정보가 없습니다.');
        return;
    }

    const { encounterId, difficulty, size, region, partition } = lastSearchParams;

    // 해당 파티션 캐시 삭제
    await rankingCache.clearEncounter(encounterId, region, partition);
    await updateCacheDisplay(rankingCache);

    showError('캐시를 삭제했습니다. 재검색을 시작합니다...');

    // 기존 검색 재실행
    await startSearchFn();
}

/**
 * 캐시 내보내기 (Gzip 압축)
 * @param {RankingCache} rankingCache - 랭킹 캐시 인스턴스
 */
export async function exportCache(rankingCache) {
    try {
        const exportData = await rankingCache.exportCache();

        if (exportData.length === 0) {
            showError('내보낼 캐시 데이터가 없습니다.');
            return;
        }

        const jsonString = JSON.stringify(exportData);
        const originalSize = jsonString.length;

        // Gzip 압축
        const encoder = new TextEncoder();
        const jsonBytes = encoder.encode(jsonString);

        // CompressionStream API 사용 (최신 브라우저)
        const stream = new Blob([jsonBytes]).stream();
        const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
        const compressedBlob = await new Response(compressedStream).blob();

        const url = URL.createObjectURL(compressedBlob);
        const a = document.createElement('a');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        a.href = url;
        a.download = `shadowtrace-cache-${timestamp}.json.gz`;
        a.click();
        URL.revokeObjectURL(url);

        // 압축 비율 표시
        const originalKB = (originalSize / 1024).toFixed(1);
        const compressedKB = (compressedBlob.size / 1024).toFixed(1);
        const ratio = ((1 - compressedBlob.size / originalSize) * 100).toFixed(0);
        showError(`캐시 ${exportData.length}개 항목을 내보냈습니다<br>${originalKB}KB → ${compressedKB}KB (${ratio}% 압축)`);
    } catch (e) {
        console.error('캐시 내보내기 실패:', e);
        showError('캐시 내보내기에 실패했습니다.');
    }
}

/**
 * 캐시 가져오기 (Gzip 압축 지원)
 * @param {RankingCache} rankingCache - 랭킹 캐시 인스턴스
 * @param {File} file - 가져올 JSON 또는 JSON.GZ 파일
 */
export async function importCache(rankingCache, file) {
    try {
        let text;

        // .gz 파일이면 압축 해제
        if (file.name.endsWith('.gz')) {
            const stream = file.stream();
            const decompressedStream = stream.pipeThrough(new DecompressionStream('gzip'));
            const decompressedBlob = await new Response(decompressedStream).blob();
            text = await decompressedBlob.text();
        } else {
            // 일반 JSON 파일
            text = await file.text();
        }

        const importData = JSON.parse(text);

        if (!Array.isArray(importData)) {
            showError('올바르지 않은 캐시 파일 형식입니다.');
            return;
        }

        const result = await rankingCache.importCache(importData);
        await updateCacheDisplay(rankingCache);

        // 상세 내역 표시
        const details = result.details;
        let message = `<strong>캐시 가져오기 완료</strong><br><br>`;
        message += `총 ${result.totalCount}개 항목 중:<br>`;
        message += `✅ ${result.importedCount}개 가져옴 (신규 또는 최신 데이터)<br>`;
        if (result.skippedCount > 0) {
            message += `⏭️ ${result.skippedCount}개 건너뜀 (이미 더 최신 데이터 보유)<br>`;
        }

        if (details.imported.length > 0) {
            message += `<br><strong>가져온 항목:</strong><br>`;
            details.imported.forEach(item => {
                message += `• ${item}<br>`;
            });
        }

        if (details.skipped.length > 0 && details.skipped.length <= 10) {
            message += `<br><strong>건너뛴 항목:</strong><br>`;
            details.skipped.forEach(item => {
                message += `• ${item}<br>`;
            });
        } else if (details.skipped.length > 10) {
            message += `<br><strong>건너뛴 항목:</strong> ${details.skipped.length}개 (목록 생략)<br>`;
        }

        await showConfirm('가져오기 완료', message, true); // 확인 버튼만 표시
    } catch (e) {
        console.error('캐시 가져오기 실패:', e);
        showError('캐시 가져오기에 실패했습니다. 파일을 확인하세요.');
    }
}
