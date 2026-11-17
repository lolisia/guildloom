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
- 컬럼은 sunken 바닥 위에 카드가 쌓이는 구조다. 컬럼 제목 줄: 단계 아이콘 32px, 픽셀 서체 12px 제목, 오른쪽에 개수(픽셀 12px muted).
- 드로어: 오른쪽 고정 패널(paper, 왼쪽 1.5px ink 선, 너비 `clamp(360px, 40vw, 560px)`). 뒤 배경은 scrim 토큰(라이트 ink 40%, 다크 거의 검정 60%)이며 **blur는 쓰지 않는다**.
- 아이콘은 다음 네 곳에만 쓴다: 컬럼 제목, 빈 상태, 배너(BossBanner/DungeonView), 상단 바 로고 옆. 16px 아이콘은 쓰지 않는다.

## Elevation & Depth
- 그림자를 기본으로 쓰지 않는다. **드래그 중인 카드만** `translate(-2px,-2px)` + `box-shadow: 4px 4px 0 ink`로 종이를 집어 든 것처럼 표현한다.
- 팝오버와 대화상자는 paper + 1.5px ink 외곽선 + `4px 4px 0 ink` 하드 그림자 하나.

## Shapes
- 반경은 2px(sm) 하나다. 버튼, 입력창, 카드, 칩 모두 같다. 원형은 쓰지 않는다 (아바타도 사각형).

## Components
- 퀘스트 카드: paper, 1.5px ink 외곽선, 패딩 8px 10px, 내부 줄 간격 4px. 번호 `#283`(픽셀 12px muted), 제목(14px 600), 태그 칩(12px, 1px line 테두리, muted), 하단 메타 줄. 등급 휘장은 쓰지 않는다. feature 의뢰에만 작은 '신규' 텍스트 칩(1px line 테두리, 12px)을 붙인다. 메타 줄의 현상금·층은 아이콘 없이 픽셀 12px 숫자만 둔다.
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
