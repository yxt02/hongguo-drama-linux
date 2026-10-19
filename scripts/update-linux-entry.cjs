require('../src/native/linux-update').runCli().catch(error => {
  console.error('更新失败：' + error.message); process.exitCode = 1;
});
