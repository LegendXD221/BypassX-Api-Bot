// ==UserScript==
// @name         BypassX Companion
// @namespace    https://bypassx-omega.vercel.app
// @version      2.0.0
// @description  Auto-completes arolinks, vplink and every AdLinkFly shortener ON YOUR device — your residential IP passes the gate the server can't — then shares the learned destination with BypassX so everyone after you gets it instantly, server-side. v2: drives the multi-step journey (btn1/btn7/gt-link/get-link), strips target=_blank, hijacks the go-link form, hooks XHR+fetch. No accounts, no captcha solving.
// @author       BypassX
// @homepage     https://bypassx-omega.vercel.app/companion
// @supportURL   https://bypassx-omega.vercel.app/companion
// @icon         https://bypassx-omega.vercel.app/favicon.ico
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      bypassx-omega.vercel.app
// @match        https://arolinks.com/*
// @match        https://vplink.in/*
// @match        https://linkpays.in/*
// @match        https://vipshort.in/*
// @match        https://link.vipshort.in/*
// @match        https://senahub.xyz/*
// @match        https://zeroinhub.com/*
// @match        https://cloverhub.app/*
// @match        https://boostylink.com/*
// @match        https://bstshrt.com/*
// @match        https://sub2unlock.com/*
// @match        https://sub2unlock.io/*
// @match        https://sub2unlock.me/*
// @match        https://sub2unlock.net/*
// @match        https://sub2unlock.xyz/*
// @match        https://sub4unlock.com/*
// @match        https://sub4unlock.io/*
// @match        https://sub4unlock.me/*
// @match        https://sub4unlock.pro/*
// @match        https://link-unlock.com/*
// @match        https://linkunlocker.com/*
// @match        https://lockr.net/*
// @match        https://lockr.so/*
// @match        https://lockr.to/*
// @match        https://boost.ink/*
// @match        https://bst.gg/*
// @match        https://bst.wtf/*
// @match        https://booo.st/*
// @match        https://droplink.co/*
// @match        https://tnlink.in/*
// @match        https://ez4short.com/*
// @match        https://xpshort.com/*
// @match        https://rocklinks.net/*
// @match        https://open2get.in/*
// @match        https://linkbnao.com/*
// @match        https://pi-l.ink/*
// @match        https://adrinolinks.in/*
// @match        https://techymozo.com/*
// @match        https://bitshorten.com/*
// @match        https://earn4link.in/*
// @match        https://za.uy/*
// @match        https://gtlinks.me/*
// ==/UserScript==

(function () {
  "use strict";
  const REPORT_URL = "https://bypassx-omega.vercel.app/api/crowd";
  const SOURCE_URL = location.href;
  const host = location.hostname.toLowerCase();
  let reported = false;

  // ---- destination reporting (cross-origin via GM_xmlhttpRequest) ----
  function report(destination) {
    if (reported) return;
    if (!destination || typeof destination !== "string") return;
    if (!/^https?:\/\//i.test(destination) || destination === "#") return;
    try {
      if (new URL(destination).hostname === host) return;
    } catch {
      return;
    }
    reported = true;
    try {
      GM_setValue("lastReport", JSON.stringify({ at: Date.now(), source: SOURCE_URL, dest: destination }));
    } catch {}
    try {
      GM_xmlhttpRequest({
        method: "POST",
        url: REPORT_URL,
        headers: { "Content-Type": "application/json" },
        data: JSON.stringify({ sourceUrl: SOURCE_URL, destination }),
        onload: () => {},
        onerror: () => {},
        ontimeout: () => {},
      });
    } catch {}
  }

  // ---- XHR hook: catch /links/go JSON {url: ...} ----
  try {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) {
      this.__bx_url = u;
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      this.addEventListener("load", function () {
        try {
          if (!/\/links\/go\b/.test(String(this.__bx_url || ""))) return;
          if (!this.responseText) return;
          let j;
          try {
            j = JSON.parse(this.responseText);
          } catch {
            const m = this.responseText.match(/"url"\s*:\s*"(https?:\/\/[^"]+)"/);
            if (m) report(m[1]);
            return;
          }
          const dest =
            (j && typeof j.url === "string" && j.url) ||
            (j && typeof j.destination === "string" && j.destination) ||
            null;
          if (dest) report(dest);
        } catch {}
      });
      return origSend.apply(this, arguments);
    };
  } catch {}

  // ---- fetch hook: catch /links/go JSON ----
  try {
    const origFetch = window.fetch;
    window.fetch = function (input, init) {
      const url = typeof input === "string" ? input : input && input.url;
      const p = origFetch.apply(this, arguments);
      if (url && /\/links\/go\b/.test(url)) {
        p.then((res) =>
          res
            .clone()
            .text()
            .then((t) => {
              try {
                const j = JSON.parse(t);
                const dest =
                  (j && typeof j.url === "string" && j.url) ||
                  (j && typeof j.destination === "string" && j.destination) ||
                  null;
                if (dest) report(dest);
              } catch {
                const m = t.match(/"url"\s*:\s*"(https?:\/\/[^"]+)"/);
                if (m) report(m[1]);
              }
            })
        ).catch(() => {});
      }
      return p;
    };
  } catch {}

  // ---- DOM helpers (run after DOM is ready) ----
  function afterDom(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  function stripTargetBlank() {
    try {
      document.querySelectorAll('a[target="_blank"], button[target="_blank"], form[target="_blank"]').forEach((el) => {
        el.removeAttribute("target");
      });
    } catch {}
  }

  function clickIfExists(sel) {
    try {
      const el = document.querySelector(sel);
      if (el && !el.disabled) {
        el.click();
        return true;
      }
    } catch {}
    return false;
  }

  function redirectIfNotDisabled(sel) {
    try {
      const el = document.querySelector(sel);
      if (el && !el.disabled) {
        const href = el.href || el.getAttribute("href");
        if (href && /^https?:\/\//i.test(href)) {
          location.href = href;
          return true;
        }
        el.click();
        return true;
      }
    } catch {}
    return false;
  }

  // Poll for an element to appear and become actionable, then act.
  function waitFor(sel, cb, opts) {
    const timeout = (opts && opts.timeout) || 60000;
    const interval = (opts && opts.interval) || 750;
    const t0 = Date.now();
    const iv = setInterval(() => {
      stripTargetBlank();
      if (cb()) {
        clearInterval(iv);
        return;
      }
      if (Date.now() - t0 > timeout) clearInterval(iv);
    }, interval);
    return iv;
  }

  // ---- Journey drivers (per-site) ----
  function driveVplinkStyle() {
    // vplink + single-step AdLinkFly: wait for a.get-link to enable, click it.
    waitFor('a.get-link, #btn-get-link, #get-link-btn, a#btn7', () => {
      if (redirectIfNotDisabled('a.get-link')) return true;
      if (clickIfExists('a#btn7')) return true;
      if (clickIfExists('#btn-get-link')) return true;
      if (clickIfExists('#get-link-btn')) return true;
      return false;
    });
  }

  function driveArolinksStyle() {
    // arolinks + multi-step AdLinkFly: click through btn1/btn7/gt-link chain,
    // strip target=_blank so we stay in-tab and can observe the final redirect.
    waitFor('a#btn1, a#btn7, #gt-link, button#btn1, button#btn7', () => {
      stripTargetBlank();
      // Click whatever's visible+enabled, in priority order.
      if (clickIfExists('a#btn7')) return false; // keep polling — there may be more steps
      if (clickIfExists('button#btn7')) return false;
      if (clickIfExists('a#btn1')) return false;
      if (clickIfExists('button#btn1')) return false;
      if (clickIfExists('#gt-link')) return false;
      if (clickIfExists('a.get-link')) return false;
      // Generic "Continue"/"Get Link" buttons
      try {
        const btns = document.querySelectorAll('button[type="submit"], a.btn');
        for (const b of btns) {
          if (b.offsetParent && !b.disabled) {
            const txt = (b.textContent || "").toLowerCase();
            if (/continue|get.?link|verify|next|download/.test(txt)) {
              b.click();
              return false; // keep polling for next step
            }
          }
        }
      } catch {}
      return false;
    }, { timeout: 90000 });
  }

  function hijackGoForm() {
    // If the page has a #go-link form, hijack its submit: POST via fetch,
    // read {url} from the JSON response, report + redirect. This matches
    // the canonical bypass-all-shortlinks technique for AdLinkFly.
    try {
      const f = document.getElementById("go-link");
      if (!f || f.__bx_hijacked) return;
      f.__bx_hijacked = true;
      f.addEventListener("submit", (e) => {
        try {
          e.preventDefault();
          const fd = new FormData(f);
          fetch(f.action || "/links/go", {
            method: "POST",
            body: fd,
            headers: { Accept: "application/json, text/javascript, */*; q=0.01", "X-Requested-With": "XMLHttpRequest" },
            credentials: "include",
          })
            .then((r) => r.text())
            .then((t) => {
              try {
                const j = JSON.parse(t);
                const dest =
                  (j && typeof j.url === "string" && j.url) ||
                  (j && typeof j.destination === "string" && j.destination) ||
                  null;
                if (dest && dest !== "#" && /^https?:\/\//i.test(dest)) {
                  report(dest);
                  location.href = dest;
                }
              } catch {}
            })
            .catch(() => {});
        } catch {}
      }, { capture: true });
    } catch {}
  }

  // ---- Meta-refresh backup (catches destination set via <meta http-equiv=refresh>) ----
  function watchMetaRefresh() {
    try {
      const obs = new MutationObserver(() => {
        if (reported) return;
        const m = document.querySelector('meta[http-equiv="refresh"][content]');
        if (m) {
          const c = m.getAttribute("content") || "";
          const u = c.match(/url=['"]?(https?:\/\/[^'">\s]+)/i);
          if (u) report(u[1]);
        }
      });
      obs.observe(document.documentElement || document, { childList: true, subtree: true });
    } catch {}
  }

  // ---- Dispatch ----
  afterDom(() => {
    stripTargetBlank();
    watchMetaRefresh();
    hijackGoForm();

    // Per-site driver selection. Both styles hook the same XHR/fetch, so the
    // destination is caught regardless of which path completes the journey.
    if (host.includes("vplink.in") || host.includes("vipshort") || host.includes("linkpays") || host.includes("earn4link") || host.includes("gtlinks")) {
      driveVplinkStyle();
    } else if (host.includes("arolinks.com") || host.includes("droplink") || host.includes("rocklinks") || host.includes("tnlink") || host.includes("ez4short") || host.includes("xpshort") || host.includes("open2get") || host.includes("linkbnao") || host.includes("adrinolinks") || host.includes("techymozo") || host.includes("bitshorten") || host.includes("za.uy")) {
      driveArolinksStyle();
    } else {
      // Generic AdLinkFly: try single-step first, fall back to multi-step.
      driveVplinkStyle();
      setTimeout(() => driveArolinksStyle(), 2000);
    }
  });
})();
