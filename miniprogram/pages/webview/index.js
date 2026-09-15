/* OpenFinLens 小程序壳：web-view 内嵌 H5。
   上线前必须完成（详见 docs/MINIPROGRAM.md）：
   1. 把 H5_URL 换成你已备案的 HTTPS 域名（项目部署在该域名下）；
   2. 在 mp.weixin.qq.com 后台「开发管理 → 业务域名」配置该域名并上传校验文件；
   3. ?crypto=off 是项目自带的合规开关（加密内容隐藏且 localStorage 持久化），
      小程序场景必须保持开启——微信禁止小程序展示加密货币行情。 */

// TODO(上线前)：替换为你的已备案 HTTPS 域名
const H5_URL = 'https://your.domain.com/openfinlens/?crypto=off&from=mp';

Page({
  data: { url: H5_URL },
  /* 转发携带同一 URL，收到的对方打开仍是小程序内嵌页 */
  onShareAppMessage() {
    return { title: 'OpenFinLens 全球看板', path: '/pages/webview/index' };
  },
});
