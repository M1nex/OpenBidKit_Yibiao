const { createBidOpportunityAdapters, SOURCES } = require('./bidOpportunityAdapters.cjs');

const QUERY_TTL_MS = 5 * 60 * 1000;
const DEFAULT_PAGE_SIZE = 20;

function normalizeDate(value) {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('投标机会查询日期格式应为 YYYY-MM-DD');
  return date;
}

function normalizeKeyword(value) {
  return String(value || '').trim();
}

function queryKey(sourceId, date, keyword) {
  return `${sourceId}|${date}|${keyword}`;
}

function createBidOpportunityService({ store }) {
  const adapters = createBidOpportunityAdapters();
  const activeQueries = new Map();

  function getSources() {
    return SOURCES.map((source) => ({ ...source }));
  }

  function isFresh(query) {
    if (!query || query.status !== 'success' || !query.complete || !query.lastCheckedAt) return false;
    return Date.now() - new Date(query.lastCheckedAt).getTime() < QUERY_TTL_MS;
  }

  async function refreshSource(sourceId, date, keyword, onProgress) {
    const key = queryKey(sourceId, date, keyword);
    const running = activeQueries.get(key);
    if (running) return running;
    const adapter = adapters.get(sourceId);
    if (!adapter) throw new Error(`未知投标机会来源：${sourceId}`);
    const task = (async () => {
      try {
        const result = await adapter.collect({ date, keyword, onProgress });
        return store.saveQuery({
          queryKey: key, sourceId, date, keyword, status: 'success', complete: true,
          remoteTotal: result.remoteTotal, error: null, warning: result.warning || null,
        }, result.notices);
      } catch (error) {
        const message = error?.message || String(error);
        return store.saveQuery({
          queryKey: key, sourceId, date, keyword, status: 'error', complete: false,
          remoteTotal: null, error: message, warning: null,
        }, []);
      } finally {
        activeQueries.delete(key);
      }
    })();
    activeQueries.set(key, task);
    return task;
  }

  async function query(request = {}, onProgress) {
    const date = normalizeDate(request.date);
    const keyword = normalizeKeyword(request.keyword);
    const sourceIds = (Array.isArray(request.sourceIds) && request.sourceIds.length ? request.sourceIds : SOURCES.map((source) => source.id))
      .filter((sourceId, index, list) => adapters.has(sourceId) && list.indexOf(sourceId) === index);
    const mode = ['cache-first', 'refresh', 'cache-only'].includes(request.mode) ? request.mode : 'cache-first';
    const page = Math.max(1, Number(request.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(request.pageSize) || DEFAULT_PAGE_SIZE));
    const sourceStates = [];

    await Promise.all(sourceIds.map(async (sourceId) => {
      const key = queryKey(sourceId, date, keyword);
      let state = store.getQuery(key);
      const shouldRefresh = mode === 'refresh' || (mode === 'cache-first' && !isFresh(state));
      if (shouldRefresh) state = await refreshSource(sourceId, date, keyword, onProgress);
      if (!state && mode === 'cache-only') {
        state = { queryKey: key, sourceId, date, keyword, status: 'unqueried', complete: false, remoteTotal: null, error: null, warning: '本地没有该来源的缓存。', lastCheckedAt: null, lastSuccessAt: null };
      }
      sourceStates.push({ sourceId, name: adapters.get(sourceId).source.name, fromCache: !shouldRefresh, ...state });
    }));
    sourceStates.sort((a, b) => sourceIds.indexOf(a.sourceId) - sourceIds.indexOf(b.sourceId));

    const keys = sourceStates.map((state) => state.queryKey);
    const listing = store.list(keys, page, pageSize, { date, keyword });
    return { ...listing, date, keyword, sourceIds, mode, sources: sourceStates };
  }

  async function getDetail(noticeId, options = {}) {
    const notice = store.getNotice(noticeId);
    if (!notice) throw new Error('投标机会公告不存在');
    if (notice.bodyHtml && !options.refresh) return notice;
    const adapter = adapters.get(notice.sourceId);
    if (!adapter) throw new Error(`未知投标机会来源：${notice.sourceId}`);
    try {
      const bodyHtml = await adapter.detail(notice);
      return store.saveDetail(noticeId, bodyHtml);
    } catch (error) {
      store.saveDetailError(noticeId, error?.message || String(error));
      throw error;
    }
  }

  return { getSources, query, getDetail };
}

module.exports = { createBidOpportunityService, QUERY_TTL_MS };
