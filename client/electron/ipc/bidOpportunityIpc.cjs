const { ipcMain } = require('electron');

function registerBidOpportunityIpc({ bidOpportunityService }) {
  ipcMain.handle('bid-opportunity:get-sources', () => bidOpportunityService.getSources());
  ipcMain.handle('bid-opportunity:query', (event, request) => bidOpportunityService.query(request, (progress) => {
    if (!event.sender.isDestroyed()) event.sender.send('bid-opportunity:progress', progress);
  }));
  ipcMain.handle('bid-opportunity:get-detail', (_event, noticeId, options) => bidOpportunityService.getDetail(noticeId, options));
}

module.exports = { registerBidOpportunityIpc };
