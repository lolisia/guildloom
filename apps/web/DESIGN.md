---
version: alpha
name: guildloom
description: 소규모 개발팀의 이슈를 길드 의뢰처럼 다루는 업무 도구. 오래 켜 두어도 읽기 편하고, 보상 숫자에서만 게임의 손맛이 난다.
colors:
  light:
    ground: "#E8EBE4"     # 석회벽 — 페이지 바탕
    paper: "#FAFAF6"      # 의뢰서 종이 — 카드, 패널, 입력창
    sunken: "#DEE2DA"     # 움푹한 영역 — 컬럼 바닥, 코드, 비활성
    ink: "#1F2429"        # 먹 — 본문, 굵은 테두리, 주 버튼 바탕 (paper 대비 14.95:1)
    scrim: "rgb(31 36 41 / 0.40)" # 모달·드로어 뒤 배경막, ink 기반 40%
    muted: "#545C64"      # 보조 텍스트 (ground 5.64:1, paper 6.49:1)
    line: "#C3C9C0"       # 얇은 구분선
    teal: "#20585B"       # 링크, 포커스 링, 정보 (paper 7.69:1)
    gold: "#7A5716"       # 보상 전용 텍스트: XP, 현상금, 레벨 (paper 6.27:1)
    gold-fill: "#CE9C3C"  # 보상 막대 채움 (XP 바, 레벨업)
    brick: "#793D35"      # 보스전, 위험, 삭제 (paper 7.93:1)
    avatar-ink: "#FAFAF6" # 아바타 이니셜 전용 — 테마와 무관하게 고정 (모든 아바타 바탕색과 4.5:1 이상)
  dark:
    ground: "#191923"
    paper: "#23232F"
    sunken: "#14141C"
    ink: "#EDE3CF"        # (ground 13.69:1)
    scrim: "rgb(8 8 12 / 0.60)" # 거의 검정 60%, 바탕보다 어둡게
    muted: "#A69F96"      # (ground 6.66:1, paper 5.93:1)
    line: "#3A3946"
    teal: "#75B5A1"
    gold: "#EFC45E"
    gold-fill: "#CE9C3C"
    brick: "#E69B72"
    # avatar-ink는 덮어쓰지 않는다 — 이니셜은 두 테마 모두 #FAFAF6.
typography:
  pixel:
    fontFamily: Galmuri11
    use: 숫자(XP, 현상금, 번호, 층, 레벨), 컬럼 제목, 로고, 배너(던전 클리어, 레벨 업)
    sizes: [12px, 16px, 22px]   # 픽셀 서체는 이 크기만
  body:
    fontFamily: IBM Plex Sans KR
    weights: [400, 500, 600]
    scale: [12px, 13px, 14px, 18px, 22px]
    lineHeight: 1.5
rounded:
  none: 0
  sm: 2px
spacing: [4px, 8px, 12px, 16px, 24px, 32px]
border:
  hairline: 1px solid line
  outline: 1.5px solid ink        # 카드, 버튼, 입력창, 패널 (다크에서는 line-strong = #5C5866)
---

## Overview
길드 회관의 의뢰 게시판. 벽(ground)에 종이 의뢰서(paper)가 붙어 있고, 먹(ink)으로 쓰여 있다.
게임 세계의 색(청록, 금, 벽돌)은 준비된 JRPG 아이콘 팔레트에서 가져왔고, **역할이 있을 때만** 쓴다.
업무 도구이므로 밀도와 가독성이 우선이다. 대담함은 **보상 숫자 한 곳에만** 쓴다.

## Colors
- ground/paper/sunken: 면의 높이는 그림자가 아니라 이 세 단계로 표현한다.
- ink: 본문, 카드·버튼 외곽선, 주 버튼(ink 바탕 + paper 글자). **주 행동 색은 ink이며 별도 강조색 버튼을 만들지 않는다.**
- teal: 링크, `:focus-visible` 링(2px solid teal, offset 2px), 정보 알림. 버튼 바탕으로 쓰지 않는다.
- gold: XP, 현상금, 레벨 텍스트와 XP 바에만 쓴다. 그 밖의 용도로 쓰지 않는다.
- brick: 보스전 단계, 오류, 삭제·의뢰 내리기 같은 파괴적 행동.
- avatar-ink: 아바타 이니셜 전용 `#FAFAF6`. 테마와 무관하게 고정하며(다크에서 `--color-paper`는 `#23232F`이므로 재사용 금지), 아래 아바타 바탕 팔레트의 모든 색과 4.5:1 이상을 유지한다.
- 단계 색: board=ink, dungeon=teal, boss=brick, cleared=gold. 컬럼 제목 아이콘 옆 2px 밑줄과 드로어의 단계 표시에만 쓴다.

## Typography
- 본문과 UI는 IBM Plex Sans KR. 제목은 600, 라벨은 500, 본문은 400. 본문 기본값은 14px/1.5다.
- 글자 크기는 12 / 13 / 14 / 18 / 22px만 쓴다.
- 픽셀 서체(Galmuri11)는 숫자, 컬럼 제목, 로고, 배너에만 쓴다. 긴 한글 문장에는 쓰지 않는다.
- 라벨은 문장형으로 쓰고 대문자 변환이나 자간 늘리기를 하지 않는다.
- 메타 정보는 가운뎃점(·)으로 잇지 않고 gap으로 띄운 별도 요소로 둔다.

## Layout
- 상단 바(paper, 아래 1.5px ink 선, 내부 높이 44px) → 본문(ground, 페이지 패딩 16px). 보드는 4컬럼 그리드(gap 12px, 좁은 화면에서는 2×2, 모바일에서는 1열).
- 너비: 상단 바와 보드 본문에는 너비 상한을 두지 않고 뷰포트 전체를 쓴다. 길드 설정 페이지는 `max-w-screen-lg`, 기록 페이지는 `max-w-screen-2xl`로 상한을 두고 둘 다 `mx-auto`로 가운데 정렬한다.
- 컬럼은 sunken 바닥 위에 카드가 쌓이는 구조다. 컬럼 패딩은 8px, 컬럼 안 항목 사이 간격도 8px이다. 컬럼 제목 줄: 단계 아이콘 32px, 픽셀 서체 12px 제목, 오른쪽에 개수(픽셀 12px muted).
- 드로어: 오른쪽 고정 패널(paper, 왼쪽 1.5px ink 선, 너비 `clamp(360px, 40vw, 560px)`). 뒤 배경은 scrim 토큰(라이트 ink 40%, 다크 거의 검정 60%)이며 **blur는 쓰지 않는다**.
- 아이콘은 다음 네 곳에만 쓴다: 컬럼 제목, 빈 상태, 배너(BossBanner/DungeonView), 상단 바 로고 옆. 16px 아이콘은 쓰지 않는다.

## Elevation & Depth
- 그림자를 기본으로 쓰지 않는다. **드래그 중인 카드만** `translate(-2px,-2px)` + `box-shadow: 4px 4px 0 ink`로 종이를 집어 든 것처럼 표현한다.
- 팝오버와 대화상자는 paper + 1.5px ink 외곽선 + `4px 4px 0 ink` 하드 그림자 하나.

## Shapes
- 반경은 2px(sm) 하나다. 버튼, 입력창, 카드, 칩 모두 같다. 원형은 쓰지 않는다 (아바타도 사각형).

## Components
- 퀘스트 카드: paper, 1.5px ink 외곽선, 패딩 8px 10px, 내부 줄 간격 4px. 최대 세 줄이다.
  - 1줄(제목): 번호 `#283`(픽셀 12px muted), feature 의뢰에만 붙는 '신규' 칩(1px line 테두리, 12px), 제목(14px 600, `line-clamp-2`, 전체 제목은 `title` 속성)을 한 줄에 나란히 둔다.
  - 2줄(태그): 태그 칩(12px, 1px line 테두리, muted)을 태그가 있을 때만 둔다.
  - 3줄(메타): `flex-wrap`, gap 8px, 최소 높이 24px인 한 줄이다. 왼쪽부터 층 진행 `3/5`(픽셀 12px)와 32x4px 막대(층 전체가 0이면 숫자와 막대를 모두 숨긴다), 현상금(픽셀 12px gold), 배수 칩(1x 초과일 때만), 대기 지명 칩(0 초과일 때만)을 두고, 오른쪽 끝에 생성 시각(12px muted)과 파티 아바타 묶음을 붙인다.
  - 파티 아바타: 24px 아바타를 1.5px 상태 테두리(joined=line, fighting=teal, done=gold)로 한 번 더 감싸고 `-space-x-1`로 겹쳐 최대 3개만 그린다. 나머지는 `+n`으로 접는다. 파티장은 첫 아바타이며 보이는 '파티장' 글자 대신 `title`과 sr-only로만 알린다.
  - 파티가 없을 때: 보드 단계 카드는 점선 '빈 파티' 칩(높이 20px)을, 다른 단계는 24px 생성자 아바타를 보여 준다.
  - 2560x1440 기준 카드 높이는 제목 한 줄에 태그 없음 88px 이하, 태그 한 줄 112px 이하이며, 이때 컬럼 하나에 제목 한 줄 카드가 13장 이상 들어간다.
  - 등급 휘장은 쓰지 않는다. 카드 안에 아이콘을 넣지 않고, 층·현상금 같은 메타 숫자도 아이콘 없이 픽셀 12px 숫자만 둔다.
- 버튼:
  - primary: ink 바탕, paper 글자
  - secondary: paper 바탕, ink 글자, 1.5px ink
  - danger: paper 바탕, brick 글자, 1.5px brick
  - ghost: 테두리 없음, hover 시 sunken
  - 높이 28px, 패딩 0 10px, 13px, 500
  - 버튼에는 아이콘을 넣지 않는다.
- 입력창: paper, 1.5px ink(라이트) / line-strong(다크), 높이 28px, 패딩 0 8px, 13px, focus 시 teal 링. 여러 줄 입력은 13px와 패딩만 맞추고 높이는 내용에 맡긴다.
- 아바타: 사각형 24/28px(큰 아바타 56px), 이름 해시 색 바탕(아이콘 팔레트의 중간 톤에서 선택), avatar-ink 글자, 1.5px ink 외곽선. 바탕 팔레트는 어둡게 조정해 모든 색이 avatar-ink와 4.5:1 이상이 되도록 유지한다.
- 태그 칩: 1px line, 12px, muted. 칩 안은 공간이 작아서 아이콘을 넣지 않는다 (아이콘은 32px 정수배 규칙). 삭제 버튼은 텍스트 "×"와 `aria-label="태그 삭제: 이름"`으로 만든다.
- 빈 상태: `empty` 아이콘 64px + 한 줄 안내 + 행동 버튼

## 채팅
- 대화 줄: 왼쪽 24px 아바타 칸(사각형 `sm`)과 오른쪽 본문 칸으로 나눈다. 머리글은 이름(14px 600 ink)과 시각(12px `text-muted` `<time dateTime>`, `HH:MM`)을 gap으로 띄운 한 줄이고, 본문은 14px/1.5 ink다. 줄 자체에는 배경이나 그림자를 두지 않는다.
- 묶기: 같은 모험가가 5분 안에 이어 쓰면 아바타와 이름, 시각을 반복하지 않고 본문만 앞 줄과 같은 자리에 붙인다(`data-grouped`). 모험가가 바뀌거나 5분이 지나거나 사이에 시스템 메시지나 이벤트 줄이 끼면 머리글을 다시 그린다.
- 시스템 메시지와 파티 타임라인의 이벤트 줄: 아바타와 아이콘 없이 `text-xs` 한 줄(`text-muted`)로 그린다. 문장은 공유 `renderSystemMessage`와 `renderEvent`를 그대로 쓰고, 이벤트 문장 속 행위자와 단계는 ink, 의뢰 참조는 teal로만 강조한다. 시스템 메시지의 의뢰 링크는 teal 밑줄이다.
- 멘션 칩: `@이름`을 작은 칩으로 그린다. 다른 모험가 멘션은 1px line 테두리 + sunken 바탕 + ink, 나를 부른 멘션은 teal 바탕 + paper 글자로 강조한다. 이름을 찾지 못하면 `@알 수 없음`으로 쓰고, 칩 안에는 아이콘을 넣지 않는다.
- 줄 행동: [의뢰로 만들기]와 [삭제]는 12px 텍스트 버튼이며 hover 또는 줄 안 focus(`group-focus-within`)일 때만 보인다. [의뢰로 만들기]는 아직 의뢰로 승격되지 않은 주점 메시지에만, [삭제]는 내가 쓴 메시지에만 붙는다. 삭제는 paper + 1.5px line-strong + `shadow-hard` 확인 대화상자(brick 삭제 버튼)를 거치고, 행동 버튼에는 아이콘을 넣지 않는다.
- 입력창: 1–6줄 높이(28px에서 시작해 128px에서 멈추고 그 안에서 스크롤)이고, Enter는 보내기, Shift+Enter는 줄바꿈이다. 한글 IME 조합 중 Enter/Tab은 제출이나 멘션 선택에 쓰지 않는다(`isImeComposing`). 전송이 실패하면 초안을 남기고 brick 경고를 띄운다. `@`를 치면 모험가 목록(최대 6명)이 paper + 1.5px line-strong + `shadow-hard` 팝오버로 열린다.
- 안 읽은 배지: 주점 탭에는 읽지 않은 메시지 수를 1px line 테두리와 sunken 바탕의 `rounded-sm` 배지에 픽셀 12px 숫자로 붙이고, 보드 카드 메타 줄에는 「새 글 n」을 12px muted로 붙인다. 둘 다 99를 넘으면 `99+`로 접되, 탭 배지의 `aria-label`은 실제 수를 읽는다(「읽지 않은 메시지 n개」).
- 주점 페이지: 상단 바 아래를 채우는 고정 높이 열이고 너비는 `max-w-screen-lg` + `mx-auto`다. 제목은 픽셀 16px이며, 대화 영역이 남는 높이를 모두 쓰고 입력창은 아래에 둔다. 이전 메시지는 스크롤 위치와 무관하게 [이전 메시지 더 보기] 버튼으로만 불러온다.
- 의뢰 드로어의 파티 채팅: 파티 메시지와 알림 대상 이벤트(`isKeyEvent`)를 시각 순으로 섞어 `max-h-[360px]` 스크롤 영역에 보여 준다. 그 아래에 같은 입력창을 두고, 모든 이벤트를 시간순으로 펼치는 [전체 기록 보기 (n)] 토글(`aria-expanded`)을 둔다. 토글은 드로어를 닫으면 접힌 상태로 돌아간다.
- 채팅에는 새 색이나 글꼴, 아이콘을 만들지 않는다. ground/paper/sunken, ink/muted/line, teal, gold, brick 토큰만 쓰며, `gold`는 보상 숫자가 아니므로 쓰지 않는다. 반경은 `rounded-sm` 하나이고, `shadow-hard`는 삭제 대화상자와 멘션 목록 팝오버에만 쓴다.

## Motion
- 상태 변화는 120–180ms ease-out만 쓴다. bounce나 elastic 이징은 쓰지 않는다.
- 레벨업과 클리어 배너만 예외적으로 짧은 연출을 허용한다. `prefers-reduced-motion`이면 애니메이션 없이 즉시 표시한다.

## Theme
- 라이트와 다크 두 테마. 기본은 OS 설정(`prefers-color-scheme`)을 따른다.
- 사용자가 상단 바 메뉴에서 `시스템 / 라이트 / 다크`를 고를 수 있고, 선택은 localStorage `gl:theme`에 저장한다.
- `<html data-theme="light|dark">`로 적용한다. 첫 렌더 전에 적용해 깜빡임이 없도록 `index.html`에 인라인 스크립트를 둔다.
- 아이콘은 두 테마에서 같은 PNG를 쓴다 (필터 금지).

## Don't
- 등급은 쓰지 않는다 (휘장·등급 열·등급 문자열 모두).
- 그라데이션(배경, 텍스트), backdrop-blur, 글로우나 컬러 그림자, `rounded-2xl` 같은 큰 반경, 대문자 자간 라벨, 가운뎃점 메타 문자열
- 이모지를 아이콘으로 쓰기 (UI 문자열과 이벤트 문장 포함), lucide 등 다른 아이콘 세트
- 에메랄드·인디고·보라 강조
- 배경막에 ink 같은 테마 반전 색을 쓰지 않는다 (scrim 토큰만 사용)
- 픽셀 서체로 본문 쓰기, 아이콘을 비정수 배율로 쓰기
- 시스템 폰트 단독 사용

## Don't change
- 아이콘 팩 `public/assets/icons/jrpg-v1/` 파일과 팔레트
