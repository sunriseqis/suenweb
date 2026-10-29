// 新标签页接管页：读开关跳转 baseUrl；未跳转时 3 秒内显示手动链接兜底
const msg = document.getElementById('msg');
const offBox = document.getElementById('off');
browser.storage.local.get({ newtabEnabled: false, baseUrl: '' }).then((cfg) => {
  if (cfg.newtabEnabled && cfg.baseUrl) {
    const target = cfg.baseUrl.replace(/\/+$/, '') + '/';
    // 手动链接兜底（跳转失败时用户可点）
    offBox.hidden = false;
    offBox.innerHTML = '<a href="' + target.replace(/"/g, '%22') + '">手动打开 SuenWeb</a> · <a href="#" id="openOptions">打开扩展设置</a>';
    document.getElementById('openOptions').addEventListener('click', (e) => {
      e.preventDefault();
      browser.runtime.openOptionsPage();
    });
    window.location.replace(target);
    // replace 后 1.5 秒仍在本页 → 跳转失败，提示
    setTimeout(() => {
      msg.textContent = '自动跳转失败，请点上方链接打开 SuenWeb。';
    }, 1500);
  } else {
    msg.textContent = 'SuenWeb 新标签页跳转已关闭。';
    offBox.hidden = false;
    offBox.innerHTML = '<a href="#" id="openOptions">打开扩展设置</a>';
    document.getElementById('openOptions').addEventListener('click', (e) => {
      e.preventDefault();
      browser.runtime.openOptionsPage();
    });
  }
});
