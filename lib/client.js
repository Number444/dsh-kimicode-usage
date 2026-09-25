/**
 * dsh-kimi-quota —— 浏览器半边。
 *
 * 两处展示：
 * 1. 设置页「Kimi Code 额度」区块（settings.section 席位）——完整卡片：
 *    5 小时滚动窗口、周窗口各一条进度条，附重置倒计时；手动刷新 + 60s 自动重拉。
 * 2. 输入框工具行紧凑徽章（conversation.input.right 席位，模型选择器左侧）——
 *    「● 5h:xx%」小药丸，圆点按剩余量绿/黄/红着色；点击弹出小悬窗，
 *    内含两个窗口的完整信息与刷新按钮，点击外部或 Esc 关闭。
 *
 * 加载 / 无 key / 上行失败 / 陈旧缓存四态齐备。
 * usages 响应解析逻辑移植自手环快应用 band-app/src/common/quota.js（久经考验）。
 */
window.__ModuleLoader__.load({
    id: 'dsh-kimi-quota',
    factory: function (require) {
        var module = { exports: {} };
        var exports = module.exports;
        var React = require('react');
        var useState = React.useState;
        var useEffect = React.useEffect;
        var useCallback = React.useCallback;
        var useRef = React.useRef;
        var h = React.createElement;

        var API_PATH = '/dsh-kimi-quota/api/usages';

        // ---------- usages 解析（移植自 band-app/src/common/quota.js，适配新响应：官方 limit_* 比率优先） ----------
        function toMs(t) {
            if (t === null || t === undefined || t === '') return 0;
            if (typeof t === 'number') return t;
            var p = Date.parse(t);
            return isNaN(p) ? 0 : p;
        }
        function toNum(v) {
            var n = Number(v);
            return isNaN(n) ? null : n;
        }
        function makeQuota(limit, remaining, resetTime) {
            var l = toNum(limit);
            var r = toNum(remaining);
            return {
                pct: (l !== null && l > 0 && r !== null) ? Math.round(r * 100 / l) : null,
                remaining: r,
                limit: l,
                resetMs: toMs(resetTime),
            };
        }
        function parseUsages(raw) {
            var result = {
                fiveHour: { pct: null, remaining: null, limit: null, resetMs: 0 },
                weekly: { pct: null, remaining: null, limit: null, resetMs: 0 },
            };
            if (!raw || typeof raw !== 'object') return result;
            var limits = Array.isArray(raw.limits) ? raw.limits : [];
            var win = null;
            for (var i = 0; i < limits.length; i++) {
                var w = limits[i] && limits[i].window;
                if (w && Number(w.duration) === 300 && String(w.timeUnit || '').indexOf('MINUTE') >= 0) {
                    win = limits[i];
                    break;
                }
            }
            if (!win && limits.length > 0) win = limits[0];
            if (win) {
                var d = win.detail || win.quota || null;
                if (d && d.limit !== undefined && d.remaining !== undefined) {
                    result.fiveHour = makeQuota(d.limit, d.remaining, d.resetTime);
                } else {
                    result.fiveHour = { pct: 100, remaining: null, limit: null, resetMs: 0 };
                }
            }
            if (raw.usage && raw.usage.limit !== undefined && raw.usage.remaining !== undefined) {
                result.weekly = makeQuota(raw.usage.limit, raw.usage.remaining, raw.usage.resetTime);
            }
            // 官方精确比率与重置时间（usages.limit_5h / limit_7d）优先：
            // 百分比取自官方 used_ratio（剩余 = 1 - used），重置时间以官方为准。
            var official = raw.usages && typeof raw.usages === 'object' ? raw.usages : null;
            if (official) {
                var r5 = official.limit_5h;
                if (r5 && typeof r5.used_ratio === 'number') {
                    result.fiveHour.pct = Math.round((1 - r5.used_ratio) * 100);
                    var t5 = toMs(r5.reset_time);
                    if (t5) result.fiveHour.resetMs = t5;
                }
                var r7 = official.limit_7d;
                if (r7 && typeof r7.used_ratio === 'number') {
                    result.weekly.pct = Math.round((1 - r7.used_ratio) * 100);
                    var t7 = toMs(r7.reset_time);
                    if (t7) result.weekly.resetMs = t7;
                }
            }
            return result;
        }
        function colorFor(pct) {
            if (pct === null || pct === undefined) return '#8e8e93';
            if (pct > 50) return '#30d158';
            if (pct >= 20) return '#ffd60a';
            return '#ff453a';
        }
        function countdownText(nowMs, resetMs) {
            if (!resetMs) return '--';
            var diff = resetMs - nowMs;
            if (diff <= 0) return '即将重置';
            var sec = Math.floor(diff / 1000);
            var d = Math.floor(sec / 86400);
            var hh = Math.floor((sec % 86400) / 3600);
            var m = Math.floor((sec % 3600) / 60);
            if (d > 0) return d + ' 天 ' + hh + ' 小时';
            if (hh > 0) return hh + ' 小时 ' + m + ' 分';
            if (m > 0) return m + ' 分钟';
            return sec + ' 秒';
        }

        // ---------- 样式 ----------
        var S = {
            root: { display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 520 },
            desc: { fontSize: 13, opacity: 0.65, lineHeight: 1.6 },
            card: {
                border: '1px solid rgba(128,128,128,0.25)',
                borderRadius: 10,
                padding: '14px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
            },
            row: { display: 'flex', flexDirection: 'column', gap: 6 },
            rowHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 13 },
            rowLabel: { fontWeight: 600 },
            rowValue: { opacity: 0.75, fontVariantNumeric: 'tabular-nums' },
            barTrack: { height: 6, borderRadius: 3, background: 'rgba(128,128,128,0.2)', overflow: 'hidden' },
            meta: { display: 'flex', justifyContent: 'space-between', fontSize: 12, opacity: 0.6 },
            footer: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, opacity: 0.75 },
            button: {
                fontSize: 12,
                padding: '4px 12px',
                borderRadius: 6,
                border: '1px solid rgba(128,128,128,0.35)',
                background: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
            },
            error: { fontSize: 12, color: '#ff453a' },
            stale: { fontSize: 12, color: '#ffd60a' },
            // 输入框徽章
            badgeWrap: { position: 'relative', display: 'inline-flex' },
            badge: {
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 12,
                lineHeight: 1,
                padding: '5px 8px',
                borderRadius: 6,
                border: 'none',
                background: 'transparent',
                color: 'inherit',
                opacity: 0.8,
                cursor: 'pointer',
                fontVariantNumeric: 'tabular-nums',
                whiteSpace: 'nowrap',
            },
            badgeDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
            popover: {
                position: 'absolute',
                bottom: '100%',
                right: 0,
                marginBottom: 8,
                width: 260,
                zIndex: 1000,
                background: 'var(--dsh-bg-elevated, rgba(30,30,32,0.98))',
                border: '1px solid rgba(128,128,128,0.3)',
                borderRadius: 10,
                boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                cursor: 'default',
            },
        };
        function barFill(pct) {
            return {
                height: '100%',
                width: (pct === null ? 0 : pct) + '%',
                background: colorFor(pct),
                borderRadius: 3,
                transition: 'width 0.4s ease',
            };
        }

        // ---------- 数据 hook（设置页区块与输入框徽章共用） ----------
        function useQuota() {
            var _s = useState({ phase: 'loading' });
            var state = _s[0]; var setState = _s[1];
            var _n = useState(Date.now());
            var now = _n[0]; var setNow = _n[1];

            var load = useCallback(function () {
                setState(function (prev) {
                    return prev.phase === 'ok' ? { phase: 'refreshing', data: prev.data, stale: prev.stale } : { phase: 'loading' };
                });
                fetch(API_PATH, { headers: { accept: 'application/json' } })
                    .then(function (r) { return r.json().then(function (body) { return { status: r.status, body: body }; }); })
                    .then(function (resp) {
                        var body = resp.body;
                        if (body && body.ok && body.value && body.value.data) {
                            setState({ phase: 'ok', data: parseUsages(body.value.data), stale: !!body.value.stale, cachedAt: body.value.cachedAt });
                        } else {
                            var msg = (body && body.error && body.error.message) || ('HTTP ' + resp.status);
                            setState({ phase: 'error', message: msg });
                        }
                    })
                    .catch(function (e) {
                        setState({ phase: 'error', message: e && e.message ? e.message : String(e) });
                    });
            }, []);

            useEffect(function () {
                load();
                var pull = setInterval(load, 60000);
                var tick = setInterval(function () { setNow(Date.now()); }, 1000);
                return function () { clearInterval(pull); clearInterval(tick); };
            }, [load]);

            return { state: state, now: now, load: load };
        }

        // ---------- 组件 ----------
        function QuotaRow(props) {
            var q = props.quota;
            var pctText = q.pct === null ? '--' : q.pct + '%';
            var numText = (q.remaining !== null && q.limit !== null)
                ? q.remaining + ' / ' + q.limit
                : (q.pct === 100 ? '全部剩余' : '--');
            return h('div', { style: S.row },
                h('div', { style: S.rowHead },
                    h('span', { style: S.rowLabel }, props.label),
                    h('span', { style: S.rowValue }, pctText + ' · ' + numText)),
                h('div', { style: S.barTrack }, h('div', { style: barFill(q.pct) })),
                h('div', { style: S.meta },
                    h('span', null, '剩余 ' + pctText),
                    h('span', null, q.resetMs ? '重置倒计时 ' + countdownText(props.now, q.resetMs) : '')));
        }

        function QuotaDetail(props) {
            var state = props.state;
            var now = props.now;
            var card = null;
            if (state.phase === 'ok' || state.phase === 'refreshing') {
                card = h(React.Fragment, null,
                    h(QuotaRow, { label: '5 小时窗口', quota: state.data.fiveHour, now: now }),
                    h(QuotaRow, { label: '每周额度', quota: state.data.weekly, now: now }));
            }
            return h(React.Fragment, null,
                state.phase === 'loading' ? h('div', { style: S.desc }, '正在查询…') : null,
                state.phase === 'error' ? h('div', { style: S.error }, '查询失败：' + state.message) : null,
                state.stale ? h('div', { style: S.stale }, '上行查询失败，正在显示稍早的缓存数据。') : null,
                card,
                h('div', { style: S.footer },
                    h('button', {
                        style: S.button,
                        disabled: state.phase === 'refreshing',
                        onClick: function () { props.load(); },
                    }, state.phase === 'refreshing' ? '刷新中…' : '立即刷新'),
                    state.phase === 'error' ? h('button', { style: S.button, onClick: function () { props.load(); } }, '重试') : null));
        }

        function KimiQuotaSection() {
            var q = useQuota();
            var state = q.state;
            if (state.phase === 'loading') {
                return h('div', { style: S.root }, h('div', { style: S.desc }, '正在查询 Kimi Code 额度…'));
            }
            return h('div', { style: S.root }, h(QuotaDetail, { state: state, now: q.now, load: q.load }));
        }

        // 输入框工具行紧凑徽章：「● 5h:xx%」，点击弹出详情小悬窗。
        function KimiQuotaBadge() {
            var q = useQuota();
            var state = q.state;
            var _o = useState(false);
            var open = _o[0]; var setOpen = _o[1];
            var wrapRef = useRef(null);

            useEffect(function () {
                if (!open) return;
                function onDown(e) {
                    if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
                }
                function onKey(e) {
                    if (e.key === 'Escape') setOpen(false);
                }
                document.addEventListener('mousedown', onDown);
                document.addEventListener('keydown', onKey);
                return function () {
                    document.removeEventListener('mousedown', onDown);
                    document.removeEventListener('keydown', onKey);
                };
            }, [open]);

            var pct = (state.phase === 'ok' || state.phase === 'refreshing') ? state.data.fiveHour.pct : null;
            var label = state.phase === 'error' ? '5h:--' : '5h:' + (pct === null ? '--' : pct + '%');
            var dotColor = state.phase === 'error' ? '#ff453a' : colorFor(pct);
            if (state.stale && pct !== null) dotColor = '#ffd60a';

            return h('div', { ref: wrapRef, style: S.badgeWrap },
                h('button', {
                    type: 'button',
                    style: S.badge,
                    title: 'Kimi Code 额度（点击查看详情）',
                    onClick: function () { setOpen(!open); },
                },
                    h('span', { style: Object.assign({}, S.badgeDot, { background: dotColor }) }),
                    h('span', null, label)),
                open ? h('div', { style: S.popover }, h(QuotaDetail, { state: state, now: q.now, load: q.load })) : null);
        }

        // ---------- 装配 ----------
        function apply(ctx) {
            if (ctx.slots === undefined || typeof ctx.slots.inject !== 'function') return;
            ctx.slots.inject('settings.section', function () {
                return ctx.slots.register({
                    name: 'settings.section',
                    id: 'dsh-kimi-quota',
                    order: 51,
                    label: function () { return 'Kimi Code 额度'; },
                }, function () {
                    return h(KimiQuotaSection);
                });
            });
            ctx.slots.inject('conversation.input.right', function () {
                return ctx.slots.register({
                    name: 'conversation.input.right',
                    id: 'dsh-kimi-quota',
                    order: 100,
                    label: function () { return 'Kimi Code 额度'; },
                }, function () {
                    return h(KimiQuotaBadge);
                });
            });
        }

        exports.inject = ['slots'];
        exports.apply = apply;
        return module.exports;
    },
});
