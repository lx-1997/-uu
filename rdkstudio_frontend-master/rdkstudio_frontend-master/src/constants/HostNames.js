// const HOST_UPDATE_BUCKET = 'http://47.92.225.44:9000/rdkstudio';
// 根据应用模式设置不同的更新链接
const getUpdateBucket = () => {
  const appMode = (process.env.APP_MODE || 'prod').toLowerCase();
  if (appMode === 'test') {
    return 'https://rdkstudio-test.bj.bcebos.com/rdkstudio';
  }
  // 默认使用生产环境
  return 'https://rdkstudio.bj.bcebos.com/rdkstudio';
};

const HOST_UPDATE_BUCKET = getUpdateBucket();

export {
    HOST_UPDATE_BUCKET
}