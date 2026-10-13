const HUNAN_BASE_URL = 'http://www.ccgp-hunan.gov.cn/';

function hunanDetailUrl(articleId, pagePath) {
  const url = new URL(pagePath, HUNAN_BASE_URL);
  url.searchParams.set('articleId', articleId);
  url.searchParams.set('parentId', '622707');
  return url.toString();
}

function getHunanSourceUrl(articleId) {
  return hunanDetailUrl(articleId, 'luban/front/detail');
}

function getHunanDetailApiUrl(articleId) {
  return hunanDetailUrl(articleId, 'portal/detail');
}

module.exports = { getHunanSourceUrl, getHunanDetailApiUrl };
