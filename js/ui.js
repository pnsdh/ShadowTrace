import { jobNameMap, serverNameMap } from './constants.js';

// ===== 헬퍼 함수 =====
function translateJobName(englishName) {
    return jobNameMap[englishName] || englishName;
}

function translateServerName(englishName, region) {
    // KR 지역일 때만 서버명 번역, 그 외에는 원본 그대로
    if (region === 'KR') {
        return serverNameMap[englishName] || englishName;
    }
    return englishName;
}

function getJobOrder(jobName) {
    const jobKeys = Object.keys(jobNameMap);
    const index = jobKeys.indexOf(jobName);
    return index !== -1 ? index : 999;
}

// ===== UI 업데이트 함수들 =====
export function showLoading(message) {
    document.getElementById('loading').classList.add('active');
    document.getElementById('status').textContent = message;
    document.getElementById('searchBtn').style.display = 'none';
    document.getElementById('stopBtn').style.display = 'block';
}

export function hideLoading() {
    document.getElementById('loading').classList.remove('active');
    document.getElementById('searchBtn').style.display = 'block';
    document.getElementById('stopBtn').style.display = 'none';
}

export function showError(message) {
    const errorEl = document.getElementById('error');
    errorEl.textContent = message;
    errorEl.classList.add('active');
    setTimeout(() => errorEl.classList.remove('active'), 5000);
}

export function hideError() {
    document.getElementById('error').classList.remove('active');
}

// 캐시 정보 표시
export async function updateCacheDisplay(rankingCache) {
    const encounterData = await rankingCache.getCacheInfoByEncounter();
    const cacheEl = document.getElementById('cacheInfo');

    if (Object.keys(encounterData).length === 0) {
        cacheEl.innerHTML = '<span class="cache-empty">캐시된 랭킹 데이터 없음</span>';
        return;
    }

    let html = '<div class="cache-list">';
    Object.keys(encounterData).sort().forEach(displayKey => {
        const info = encounterData[displayKey];
        const latestTime = new Date(info.latest).toLocaleString('ko-KR', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });

        // 파티션 표시 생성
        const partitionNum = info.partition === 'default' ? null : info.partition;
        let partitionDisplay;
        if (info.partitionName) {
            partitionDisplay = `P${partitionNum} - ${info.partitionName}`;
        } else if (partitionNum) {
            partitionDisplay = `P${partitionNum}`;
        } else {
            partitionDisplay = 'P?';
        }

        const displayName = `${info.encounterName}, ${info.region}, ${partitionDisplay}`;

        html += `
            <div class="cache-item">
                <div class="cache-item-content">
                    <span class="cache-item-info"><strong>${displayName}</strong></span>
                    <span class="cache-item-info">${info.count}개 페이지, ${info.sizeFormatted} (${latestTime})</span>
                </div>
                <button onclick='clearEncounterCache(${JSON.stringify(info.encounterId)}, ${JSON.stringify(info.region)}, ${JSON.stringify(info.partition)})' class="cache-delete-btn">
                    삭제
                </button>
            </div>
        `;
    });
    html += '</div>';

    cacheEl.innerHTML = html;
}

// ===== 결과 표시 =====
export async function displayResults(matches, api, allRankingsData, rankingCache, matchedFightInfo, anonymousReportCode, appendMode = false) {
    const resultsEl = document.getElementById('results');
    const resultsListEl = document.getElementById('resultsList');

    // 익명 로그 URL에서 서브도메인 추출
    const anonymousUrlInput = document.getElementById('anonymousUrl').value.trim();
    let subdomain = 'www';
    if (anonymousUrlInput) {
        const urlMatch = anonymousUrlInput.match(/https?:\/\/([^.]+)\.fflogs\.com/);
        if (urlMatch) {
            subdomain = urlMatch[1];
        }
    }

    if (matches.length === 0 && !appendMode) {
        // 캐시 업데이트 필요 여부 확인
        let showRefreshButton = false;

        if (matchedFightInfo && window.lastSearchParams) {
            const { encounterId, difficulty, size, region, partition, reportStartTime } = window.lastSearchParams;

            // 해당 파티션의 캐시가 존재하는지 확인
            const hasCacheForFight = await rankingCache.hasCacheForFight(
                encounterId,
                difficulty,
                size,
                region,
                partition
            );

            if (hasCacheForFight) {
                // 캐시의 최신 timestamp 조회
                const latestCacheTimestamp = await rankingCache.getLatestCacheTimestamp(
                    encounterId,
                    difficulty,
                    size,
                    region,
                    partition
                );

                // 익명 로그의 시작 시간이 캐시보다 최신인지 확인
                if (latestCacheTimestamp && reportStartTime > latestCacheTimestamp) {
                    showRefreshButton = true;
                }
            }
        }

        let refreshButtonHtml = '';
        if (showRefreshButton) {
            refreshButtonHtml = `
                <button onclick="refreshCacheAndSearch()" class="refresh-cache-btn">
                    🔄 캐시 업데이트 후 재검색
                </button>
            `;
        }

        resultsListEl.innerHTML = `
            <div class="no-results">
                <div class="no-results-title">매칭되는 원본 로그를 찾지 못했습니다</div>
                <div class="no-results-hint">
                    • 검색에 잡히는 랭킹 데이터가 없을 수 있습니다.<br>
                    • 캐시가 너무 옛버전이면 최근 데이터가 잡히지 않을 수 있습니다.<br>
                </div>
                ${refreshButtonHtml}
            </div>
        `;
        resultsEl.classList.add('active');
        return;
    }

    if (matches.length === 0 && appendMode) {
        return; // 추가 모드에서 결과가 없으면 아무것도 하지 않음
    }

    // 같은 리포트(reportCode + fightID)로 그룹화
    const groupedMatches = {};
    matches.forEach(match => {
        const reportCode = match.ranking.report?.code || '';
        const fightID = match.ranking.report?.fightID || '';
        const key = `${reportCode}_${fightID}`;

        if (!groupedMatches[key]) {
            groupedMatches[key] = {
                reportCode,
                fightID,
                matches: [],
                startTime: match.ranking.startTime,
                duration: match.ranking.duration,
                anonymousFightId: match.fightId // 익명 로그의 fight ID
            };
        }

        groupedMatches[key].matches.push(match);
    });

    // 플레이어 이름 추출: 캐시가 있으면 캐시에서, 없으면 allRankingsData에서
    let allRankingPlayers = new Set();

    if (matchedFightInfo && rankingCache) {
        // 캐시된 모든 플레이어 가져오기
        allRankingPlayers = await rankingCache.getAllCachedPlayers(
            matchedFightInfo.encounterId,
            matchedFightInfo.difficulty,
            matchedFightInfo.size,
            matchedFightInfo.region,
            matchedFightInfo.partition
        );
    } else {
        // allRankingsData에서 플레이어 추출 (구버전 호환)
        allRankingsData.forEach(rankingData => {
            if (rankingData && rankingData.rankings && Array.isArray(rankingData.rankings)) {
                rankingData.rankings.forEach(ranking => {
                    if (ranking && ranking.name && ranking.name !== 'Anonymous' && ranking.name !== 'anonymous') {
                        allRankingPlayers.add(ranking.name);
                    }
                });
            }
        });
    }

    // 시작 시간 순으로 정렬
    const sortedGroups = Object.values(groupedMatches).sort((a, b) => a.startTime - b.startTime);

    let html = '';

    // 각 그룹별로 플레이어 정보 가져오기
    for (const group of sortedGroups) {
        const timeFormatted = new Date(group.startTime).toLocaleString('ko-KR', { hour12: false });
        const durationSec = (group.duration / 1000).toFixed(1);

        // 플레이어 목록 가져오기
        let playersHtml = '로딩 중...';
        try {
            // 매칭된 플레이어 이름 추출
            const matchedPlayerNames = new Set();
            group.matches.forEach(match => {
                if (match.ranking && match.ranking.name) {
                    matchedPlayerNames.add(match.ranking.name);
                }
            });

            const reportData = await api.getReportPlayers(group.reportCode, group.fightID);
            const actors = reportData.masterData?.actors;

            // 매칭된 랭킹에서 region 정보 추출
            let detectedRegion = null;
            if (group.matches && group.matches.length > 0) {
                const firstMatch = group.matches[0];
                if (firstMatch.ranking && firstMatch.ranking.server && firstMatch.ranking.server.region) {
                    detectedRegion = firstMatch.ranking.server.region;
                }
            }

            if (actors && Array.isArray(actors)) {
                const playersData = [];

                // 모든 플레이어 데이터 수집
                actors.forEach(actor => {
                    if (actor) {
                        const playerName = actor.name || '알 수 없음';
                        const serverName = actor.server || '알 수 없음';
                        const spec = actor.subType || actor.type || '';

                        // 서버가 "알 수 없음"이면 제외
                        if (serverName === '알 수 없음') {
                            return;
                        }

                        // 랭킹에서 찾은 플레이어인지 확인
                        const isFound = allRankingPlayers.has(playerName);
                        // 매칭된 플레이어인지 확인
                        const isMatched = matchedPlayerNames.has(playerName);

                        let itemClass = 'player-item';
                        if (!isFound) {
                            itemClass = 'player-item not-found';
                        } else if (isMatched) {
                            itemClass = 'player-item matched';
                        }

                        // 서버명과 직업명 변환 (KR 지역일 때만 서버명 한글화)
                        const serverNameKo = translateServerName(serverName, detectedRegion);
                        const specKo = translateJobName(spec);

                        playersData.push({
                            spec: spec,
                            name: playerName,
                            serverName: serverName,
                            serverNameKo: serverNameKo,
                            specKo: specKo,
                            itemClass: itemClass,
                            isFound: isFound,
                            order: getJobOrder(spec)
                        });
                    }
                });

                // 1순위: 직업 순서, 2순위: 이름 가나다순
                playersData.sort((a, b) => {
                    if (a.order !== b.order) {
                        return a.order - b.order;
                    }
                    return a.name.localeCompare(b.name, 'ko');
                });

                // 2단 레이아웃: 전반부/후반부로 분할
                const halfPoint = Math.ceil(playersData.length / 2);
                const firstHalf = playersData.slice(0, halfPoint);
                const secondHalf = playersData.slice(halfPoint);

                // HTML 생성
                let playersListHtml = '';
                for (let i = 0; i < halfPoint; i++) {
                    const leftPlayer = firstHalf[i];
                    const rightPlayer = secondHalf[i];

                    let leftHtml = '';
                    if (leftPlayer) {
                        if (leftPlayer.isFound) {
                            // FFLogs 캐릭터 페이지 링크
                            const regionLower = detectedRegion ? detectedRegion.toLowerCase() : 'na';
                            const serverLower = leftPlayer.serverName.toLowerCase();
                            const nameLower = leftPlayer.name.toLowerCase();
                            const domain = detectedRegion === 'KR' ? 'ko.fflogs.com' : 'www.fflogs.com';
                            const characterUrl = `https://${domain}/character/${regionLower}/${serverLower}/${encodeURIComponent(nameLower)}`;
                            leftHtml = `<a href="${characterUrl}" target="_blank" class="${leftPlayer.itemClass}">${leftPlayer.name}@${leftPlayer.serverNameKo} (${leftPlayer.specKo})</a>`;
                        } else {
                            leftHtml = `<div class="${leftPlayer.itemClass}">${leftPlayer.name}@${leftPlayer.serverNameKo} (${leftPlayer.specKo})</div>`;
                        }
                    }

                    let rightHtml = '';
                    if (rightPlayer) {
                        if (rightPlayer.isFound) {
                            const regionLower = detectedRegion ? detectedRegion.toLowerCase() : 'na';
                            const serverLower = rightPlayer.serverName.toLowerCase();
                            const nameLower = rightPlayer.name.toLowerCase();
                            const domain = detectedRegion === 'KR' ? 'ko.fflogs.com' : 'www.fflogs.com';
                            const characterUrl = `https://${domain}/character/${regionLower}/${serverLower}/${encodeURIComponent(nameLower)}`;
                            rightHtml = `<a href="${characterUrl}" target="_blank" class="${rightPlayer.itemClass}">${rightPlayer.name}@${rightPlayer.serverNameKo} (${rightPlayer.specKo})</a>`;
                        } else {
                            rightHtml = `<div class="${rightPlayer.itemClass}">${rightPlayer.name}@${rightPlayer.serverNameKo} (${rightPlayer.specKo})</div>`;
                        }
                    }

                    playersListHtml += `
                        <div class="player-row">
                            <div class="player-col">${leftHtml}</div>
                            <div class="player-col">${rightHtml}</div>
                        </div>
                    `;
                }

                if (playersData.length > 0) {
                    playersHtml = `<div class="players-container">${playersListHtml}</div>`;
                } else {
                    playersHtml = '<div class="no-player-info">플레이어 정보 없음</div>';
                }
            } else {
                playersHtml = '플레이어 정보 없음';
            }
        } catch (e) {
            console.error('플레이어 정보 가져오기 실패:', e);
            playersHtml = '<div>플레이어 정보를 가져올 수 없습니다.</div>';
        }

        html += `
            <div class="result-item">
                <div class="result-details">
                    ${playersHtml}

                    <div class="result-footer">
                        <div class="result-time-info">
                            시작 시간: <strong>${timeFormatted}</strong><br>
                            전투 시간: <strong>${durationSec}초</strong>
                        </div>
                        <div class="result-links">
                            <a href="https://${subdomain}.fflogs.com/reports/${anonymousReportCode}#fight=${group.anonymousFightId}" target="_blank" class="result-link-btn anonymous-log">
                                🔒 익명 로그
                            </a>
                            <a href="https://${subdomain}.fflogs.com/reports/${group.reportCode}#fight=${group.fightID}" target="_blank" class="result-link-btn public-log">
                                📊 원본 로그
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    if (appendMode) {
        // 기존 결과에 추가
        resultsListEl.insertAdjacentHTML('beforeend', html);
    } else {
        // 새로운 결과로 교체
        resultsListEl.innerHTML = html;
    }

    resultsEl.classList.add('active');

    // 결과 영역으로 스크롤 (append 모드일 때는 자동 스크롤 안 함)
    if (!appendMode) {
        setTimeout(() => {
            resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    }
}
