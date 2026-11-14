---
version: alpha
name: guildloom
description: 소규모 개발팀의 이슈를 길드 의뢰처럼 다루는 업무 도구. 오래 켜 두어도 읽기 편하고, 보상과 등급에서만 게임의 손맛이 난다.
colors:
  light:
    ground: "#E8EBE4"     # 석회벽 — 페이지 바탕
    paper: "#FAFAF6"      # 의뢰서 종이 — 카드, 패널, 입력창
    sunken: "#DEE2DA"     # 움푹한 영역 — 컬럼 바닥, 코드, 비활성
    ink: "#1F2429"        # 먹 — 본문, 굵은 테두리, 주 버튼 바탕 (paper 대비 14.95:1)
    muted: "#545C64"      # 보조 텍스트 (ground 5.64:1, paper 6.49:1)
    line: "#C3C9C0"       # 얇은 구분선
    teal: "#20585B"       # 링크, 포커스 링, 정보 (paper 7.69:1)
    gold: "#7A5716"       # 보상 전용 텍스트: XP, 현상금, 레벨 (paper 6.27:1)
    gold-fill: "#CE9C3C"  # 보상 막대 채움 (XP 바, 레벨업)
    brick: "#793D35"      # 보스전, 위험, 삭제 (paper 7.93:1)
  dark:
    ground: "#191923"
    paper: "#23232F"
    sunken: "#14141C"
    ink: "#EDE3CF"        # (ground 13.69:1)
    muted: "#A69F96"      # (ground 6.66:1, paper 5.93:1)
    line: "#3A3946"
    teal: "#75B5A1"
    gold: "#EFC45E"
    gold-fill: "#CE9C3C"
    brick: "#E69B72"
typography:
  pixel:
    fontFamily: Galmuri11
    use: 등급·숫자(XP, 현상금, 번호, 층, 레벨), 컬럼 제목, 로고, 배너(던전 클리어, 레벨 업)
    sizes: [12px, 16px, 22px]   # 픽셀 서체는 이 크기만
  body:
    fontFamily: IBM Plex Sans KR
    weights: [400, 500, 600]
    scale: [12px, 13px, 15px, 18px, 22px]
    lineHeight: 1.6
rounded:
  none: 0
  sm: 2px
spacing: [4px, 8px, 12px, 16px, 24px, 32px]
border:
  hairline: 1px solid line
  outline: 1.5px solid ink        # 카드, 버튼, 입력창, 패널 (다크에서는 line-strong = #5C5866)
---

## Overview
길드 회관의 의뢰 게시판. 벽(ground)에 종이 의뢰서(paper)가 붙어 있고, 먹(ink)으로 쓰여 있다. 등급은 아이콘 팩의 등급 휘장(rank-*)으로 찍힌다.
게임 세계의 색(청록, 금, 벽돌)은 준비된 JRPG 아이콘 팔레트에서 가져왔고, **역할이 있을 때만** 쓴다.
업무 도구이므로 밀도와 가독성이 우선이다. 대담함은 **등급 휘장과 보상 숫자 한 곳에만** 쓴다.

## Colors
- ground/paper/sunken: 면의 높이는 그림자가 아니라 이 세 단계로 표현한다.
- ink: 본문, 카드·버튼 외곽선, 주 버튼(ink 바탕 + paper 글자). **주 행동 색은 ink이며 별도 강조색 버튼을 만들지 않는다.**
- teal: 링크, `:focus-visible` 링(2px solid teal, offset 2px), 정보 알림. 버튼 바탕으로 쓰지 않는다.
- gold: XP, 현상금, 레벨 텍스트와 XP 바에만 쓴다. 그 밖의 용도로 쓰지 않는다.
- brick: 보스전 단계, 오류, 삭제·의뢰 내리기 같은 파괴적 행동.
- 단계 색: board=ink, dungeon=teal, boss=brick, cleared=gold. 컬럼 제목 아이콘 옆 2px 밑줄과 드로어의 단계 표시에만 쓴다.

## Typography
- 본문과 UI는 IBM Plex Sans KR. 제목은 600, 라벨은 500, 본문은 400.
- 픽셀 서체(Galmuri11)는 숫자, 등급, 컬럼 제목, 로고, 배너에만 쓴다. 긴 한글 문장에는 쓰지 않는다.
- 라벨은 문장형으로 쓰고 대문자 변환이나 자간 늘리기를 하지 않는다.
- 메타 정보는 가운뎃점(·)으로 잇지 않고 gap으로 띄운 별도 요소로 둔다.

## Layout
- 상단 바(paper, 아래 1.5px ink 선) → 본문(ground). 보드는 4컬럼 그리드(gap 20px, 좁은 화면에서는 2×2, 모바일에서는 1열).
- 컬럼은 sunken 바닥 위에 카드가 쌓이는 구조다. 컬럼 제목 줄: 단계 아이콘 32px, 픽셀 서체 16px 제목, 오른쪽에 개수(픽셀 12px muted).
- 드로어: 오른쪽 고정 패널(paper, 왼쪽 1.5px ink 선). 뒤 배경은 ink 40% 반투명이며 **blur는 쓰지 않는다**.

## Elevation & Depth
- 그림자를 기본으로 쓰지 않는다. **드래그 중인 카드만** `translate(-2px,-2px)` + `box-shadow: 4px 4px 0 ink`로 종이를 집어 든 것처럼 표현한다.
- 팝오버와 대화상자는 paper + 1.5px ink 외곽선 + `4px 4px 0 ink` 하드 그림자 하나.

## Shapes
- 반경은 2px(sm) 하나다. 버튼, 입력창, 카드, 칩 모두 같다. 원형은 쓰지 않는다 (아바타도 사각형).

## Components
- 퀘스트 카드: paper, 1.5px ink 외곽선, 패딩 12px 14px. 오른쪽 위에 **등급 휘장 아이콘 32px**(rank-* / 등급 없음은 rank-none, `aria-hidden`이고 옆에 sr-only로 "등급 D"). 번호 `#283`(픽셀 12px muted), 제목(15px 600), 태그 칩(12px, 1px line 테두리, muted), 하단 메타 줄.
- 버튼:
  - primary: ink 바탕, paper 글자
  - secondary: paper 바탕, ink 글자, 1.5px ink
  - danger: paper 바탕, brick 글자, 1.5px brick
  - ghost: 테두리 없음, hover 시 sunken
  - 높이 32px, 패딩 0 12px, 500
  - 아이콘이 붙으면 32px 아이콘을 왼쪽에 두고 gap은 6px. 작은 버튼에서는 아이콘을 생략한다.
- 입력창: paper, 1.5px ink(라이트) / line-strong(다크), focus 시 teal 링
- 아바타: 사각형 24/32px, 이름 해시 색 바탕(아이콘 팔레트의 중간 톤에서 선택), paper 글자, 1.5px ink 외곽선
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
- 그라데이션(배경, 텍스트), backdrop-blur, 글로우나 컬러 그림자, `rounded-2xl` 같은 큰 반경, 대문자 자간 라벨, 가운뎃점 메타 문자열
- 이모지를 아이콘으로 쓰기 (UI 문자열과 이벤트 문장 포함), lucide 등 다른 아이콘 세트
- 에메랄드·인디고·보라 강조
- 픽셀 서체로 본문 쓰기, 아이콘을 비정수 배율로 쓰기
- 시스템 폰트 단독 사용

## Don't change
- 아이콘 팩 `public/assets/icons/jrpg-v1/` 파일과 팔레트
