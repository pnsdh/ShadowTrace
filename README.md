# ShadowTrace

FFLogs 익명 로그의 원본 로그를 찾는 도구

## 사용 방법

1. [FFLogs API Clients](https://www.fflogs.com/api/clients/)에서 Client를 생성하고 API 키 입력
2. 익명 로그 URL 입력 (특정 Fight URL 권장, 예: `?fight=7`)
3. 자동으로 원본 로그 검색

## 기능

- 시간, 전투 길이, 플레이어 정보 기반 매칭
- 랭킹 데이터 자동 캐시 (IndexedDB)
- 캐시 내보내기/가져오기 (Gzip 압축)

## 요구사항

- Chrome 80+ / Firefox 113+
- FFLogs API 키

## 라이선스

MIT
