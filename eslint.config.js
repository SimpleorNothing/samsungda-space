// 배포 전 자동 검증용 ESLint 설정 (CI 전용 — Cloudflare Pages 빌드와 무관)
//
// 이 저장소가 한 번 겪은 사고:
//   서로 다른 갈래가 같은 기능(로비 구분선/정렬)을 다르게 구현 → git 자동병합이
//   서로 다른 줄이라 "충돌 없이" 양쪽을 뒤섞음 → 존재하지 않는 변수(orderBtn)를
//   참조하는 코드가 생성됨 → 인라인 스크립트가 ReferenceError로 통째 중단 →
//   방 목록이 "불러오는 중…"에서 영구 멈춤. CF Pages는 JS 동작을 검사하지 않아
//   깨진 채로 배포(초록 체크)됨.
//
// 그 사고를 다시 막는 핵심 규칙:
//   - no-undef    : 선언 없이 쓰는 식별자(orderBtn, reorder 등) 차단
//   - no-redeclare: 중복 선언(var dividerPos 두 번 등) 차단
//   - no-dupe-keys / no-unreachable 등 기본 오류 차단
//
// eslint-plugin-html 이 .html 안의 <script> 블록을 추출해 검사하므로,
// 정적 HTML(public/index.html)의 인라인 로비 스크립트까지 잡아냅니다.

import html from 'eslint-plugin-html';
import globals from 'globals';

export default [
  // 외부 라이브러리·산출물은 검사 제외
  { ignores: ['public/sortable.min.js', 'node_modules/**'] },

  // 로비 등 정적 HTML의 인라인 브라우저 스크립트
  {
    files: ['public/**/*.html'],
    plugins: { html },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        Sortable: 'readonly', // sortable.min.js 전역
      },
    },
    rules: {
      'no-undef': 'error',
      'no-redeclare': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      'no-cond-assign': 'error',
    },
  },

  // Cloudflare Pages Functions (ES 모듈, Workers 런타임)
  {
    files: ['functions/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.worker,
        crypto: 'readonly',
        caches: 'readonly',
      },
    },
    rules: {
      'no-redeclare': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
    },
  },
];
