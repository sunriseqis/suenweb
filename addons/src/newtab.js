// 新标签页接管页：读取 baseUrl 跳转；关闭开关时跳回浏览器默认 about:newtab
browser.storage.local.get({ newtabEnabled: false, baseUrl: '' }).then((cfg) => {
  if (cfg.newtabEnabled && cfg.baseUrl) {
    window.location.replace(cfg.baseUrl.replace(/\/+$/, '') + '/');
  } else {
    // 开关关闭：回到浏览器默认新标签（不可循环：override 页仍是本页 → 提示去设置）
    document.getElementById('msg').textContent = 'SuenWeb 新标签页跳转已关闭。可在扩展设置里开启。';
  }
});
