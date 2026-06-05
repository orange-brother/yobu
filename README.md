# Yobu

놓치기 쉬운 순간을 영상으로 알려주는 macOS 메뉴바 리마인더.

Yobu는 정해진 시간이나 Google Calendar 일정 전에 짧은 영상을 화면 위에 띄워주는 앱입니다. 텍스트 알림이 쉽게 묻히는 순간에, 더 분명한 시각적 신호를 만들기 위해 만들었습니다.

## What You Can Do

- 영상 보관함에 `mp4`, `mov`, `m4v`, `webm` 파일을 추가합니다.
- 특정 날짜, 반복 요일, 시간, 간격에 맞춰 영상을 표시합니다.
- Google Calendar 일정 시작 전에 영상을 표시합니다.
- 화면 위에 프레임 없는 Stage로 영상을 띄웁니다.
- 말풍선, 반복 재생, 소리 재생을 큐마다 설정합니다.
- 로컬 MCP 서버를 통해 AI 도구에서 영상을 즉시 호출하거나 큐를 만들 수 있습니다.

## How It Works

1. 영상을 추가합니다.
2. 새 큐를 만듭니다.
3. 언제 표시할지 정합니다.
4. 지정된 순간에 Yobu가 화면 위에 영상을 띄웁니다.

## Core Concepts

- **Cue**: 언제 어떤 영상을 표시할지 정한 항목입니다.
- **Library**: Yobu에서 사용할 영상을 보관하는 곳입니다.
- **Stage**: 실제 화면 위에 영상이 표시되는 영역입니다.
- **MCP**: AI 도구가 Yobu를 로컬에서 제어할 수 있게 하는 연결입니다.

## Requirements

- macOS Sonoma 14.6 이상
- Node.js
- pnpm

## Development

```bash
pnpm install
pnpm dev
pnpm test
pnpm build
pnpm package:mac
```

투명 배경 예시 영상을 생성하려면:

```bash
pnpm sample:transparent-video
```

## Google Calendar

Google Calendar 연동은 Desktop OAuth와 로컬 loopback redirect를 사용합니다. 연결하면 선택한 캘린더의 일정 시작 전 지정된 시점에 큐를 표시할 수 있습니다.

Google Cloud에서 Calendar API를 활성화하고 Desktop OAuth Client를 만든 뒤, 로컬 `.env` 파일에 값을 넣습니다.

```env
YOBU_GOOGLE_CLIENT_ID=
YOBU_GOOGLE_CLIENT_SECRET=
```

`.env`는 git에 포함되지 않습니다.

## MCP

Yobu는 로컬 MCP 서버를 포함합니다. 앱이 실행 중이면 AI 도구가 다음 작업을 할 수 있습니다.

- 보관함 영상 조회
- 로컬 영상 파일 추가
- 영상을 즉시 Stage에 표시
- 큐 생성
- 큐 목록 조회
- 큐 비활성화

현재 MCP는 로컬 전용으로 동작합니다.

## Build

macOS DMG는 아래 경로에 생성됩니다.

```text
dist/Yobu-0.1.0-arm64.dmg
```

로컬 개발 빌드는 서명과 notarization이 적용되지 않습니다.

## Privacy

Yobu는 설정과 가져온 영상을 macOS Application Support 디렉터리에 저장합니다. 서버 계정이 필요하지 않습니다.

## License

MIT
