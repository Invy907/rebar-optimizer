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

const cardHtml = [
  '<div style="' + CARD_STYLE + '">',
  '<h1 style="margin:0 0 16px;font-size:18px;font-weight:700;">',
  'ご利用のブラウザはサポート対象外です',
  '</h1>',
  '<p style="margin:0 0 12px;font-size:15px;">',
  '本システムは <strong>Google Chrome</strong> でのご利用をお願いしております。',
  '</p>',
  '<p style="margin:0;font-size:14px;color:#64748b;">',
  'Google Chrome をインストールするか、Google Chrome から再度アクセスしてください。',
  '</p>',
  '</div>',
].join('')

/** ES5 のみ。テンプレートリテラル・アロー関数・const は使わない。 */
export const BROWSER_SUPPORT_NOTICE_SCRIPT = [
  '(function(){',
  'var CARD=' + JSON.stringify(cardHtml) + ';',
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
  'el.innerHTML=CARD;',
  'document.body.appendChild(el);',
  '}',
  'if(document.readyState==="loading"){',
  'document.addEventListener("DOMContentLoaded",show);',
  '}else{show();}',
  '})();',
].join('')
