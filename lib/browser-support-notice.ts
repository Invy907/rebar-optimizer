/**
 * サポート対象外ブラウザ向けの案内（Google Chrome 限定）。
 *
 * アプリ本体のバンドルは古いブラウザでは解析に失敗し得るため、
 * React ではなくインラインの classic script として実行する。
 * ES5 構文のみ・Tailwind 不使用（インラインスタイル）。
 */

const OVERLAY_STYLE = [
  'position:fixed',
  'top:0',
  'left:0',
  'right:0',
  'bottom:0',
  'z-index:2147483647',
  'display:flex',
  'align-items:center',
  'justify-content:center',
  'padding:16px',
  'background:rgba(15,23,42,0.72)',
].join(';')

const CARD_STYLE = [
  'box-sizing:border-box',
  'width:100%',
  'max-width:480px',
  'background:#ffffff',
  'border-radius:12px',
  'padding:32px 28px',
  'box-shadow:0 10px 40px rgba(0,0,0,0.3)',
  "font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Yu Gothic',Meiryo,sans-serif",
  'color:#0f172a',
  'line-height:1.75',
  'text-align:center',
].join(';')

function buildCard(title: string, bodyHtml: string, footnote: string) {
  return [
    '<div style="' + CARD_STYLE + '">',
    '<h1 style="margin:0 0 16px;font-size:18px;font-weight:700;">',
    title,
    '</h1>',
    '<p style="margin:0 0 12px;font-size:15px;">',
    bodyHtml,
    '</p>',
    '<p style="margin:0;font-size:14px;color:#64748b;">',
    footnote,
    '</p>',
    '</div>',
  ].join('')
}

/** Chrome 以外 */
const cardHtmlNonChrome = buildCard(
  'ご利用のブラウザはサポート対象外です',
  '本システムは <strong>Google Chrome</strong> でのご利用をお願いしております。',
  'Google Chrome をインストールするか、Google Chrome から再度アクセスしてください。',
)

/** Chrome だがバージョンが古い（color-mix 非対応） */
const cardHtmlOldChrome = buildCard(
  'Google Chrome のバージョンが古いです',
  '本システムを正しく表示するには、<strong>Google Chrome 111 以降</strong> が必要です。',
  'お使いのパソコンでは対応できない場合があります。別のパソコンから Google Chrome でアクセスしてください。',
)

/** ES5 のみ。テンプレートリテラル・アロー関数・const は使わない。 */
export const BROWSER_SUPPORT_NOTICE_SCRIPT = [
  '(function(){',
  'var CARD_NON_CHROME=' + JSON.stringify(cardHtmlNonChrome) + ';',
  'var CARD_OLD_CHROME=' + JSON.stringify(cardHtmlOldChrome) + ';',
  'var OVERLAY=' + JSON.stringify(OVERLAY_STYLE) + ';',
  'function isGoogleChrome(){',
  'try{',
  'var ua=navigator.userAgent||"";',
  'if(/CriOS\\//.test(ua))return true;',
  'if(/Edg\\//.test(ua))return false;',
  'if(/OPR\\//.test(ua))return false;',
  'if(/SamsungBrowser\\//.test(ua))return false;',
  'if(/Chrome\\//.test(ua)&&!/Chromium\\//.test(ua))return true;',
  'return false;',
  '}catch(e){return false;}',
  '}',
  'function hasRequiredCss(){',
  'try{',
  'return !!(window.CSS&&window.CSS.supports&&window.CSS.supports("color","color-mix(in oklab, red 50%, blue)"));',
  '}catch(e){return false;}',
  '}',
  'function ok(){return isGoogleChrome()&&hasRequiredCss();}',
  'function pickCard(){',
  'if(isGoogleChrome()&&!hasRequiredCss())return CARD_OLD_CHROME;',
  'return CARD_NON_CHROME;',
  '}',
  'function lockScroll(){',
  'try{',
  'document.documentElement.style.overflow="hidden";',
  'document.body.style.overflow="hidden";',
  '}catch(e){}',
  '}',
  'function show(){',
  'if(ok())return;',
  'if(!document.body)return;',
  'if(document.getElementById("browser-support-notice"))return;',
  'lockScroll();',
  'var el=document.createElement("div");',
  'el.id="browser-support-notice";',
  'el.setAttribute("style",OVERLAY);',
  'el.innerHTML=pickCard();',
  'document.body.appendChild(el);',
  '}',
  'if(document.readyState==="loading"){',
  'document.addEventListener("DOMContentLoaded",show);',
  '}else{show();}',
  '})();',
].join('')
