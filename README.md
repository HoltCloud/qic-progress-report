# QIC 作业进度小时跟进表

纯前端 Excel 分析页面，用于生成“水贝珠宝质检中心 作业进度小时跟进表”。

## 特点

- Excel 文件只在浏览器本地解析，不上传服务器。
- 8 小时时效从 `入库时间` 开始计算。
- 支持导出图片和打印。
- 支持 GitHub Pages 自动部署。

## 本地运行

```bash
npm install
npm run dev
```

## 验证

```bash
npm test
npm run build
```

`npm test` 默认读取 `/Users/holtcloud/Downloads/QIC订单导出_1.xlsx`，也可以用环境变量指定：

```bash
SAMPLE_XLSX=/path/to/file.xlsx npm test
```

## GitHub Pages 部署

1. 新建 GitHub 仓库：`qic-progress-report`
2. 将本项目推送到仓库的 `main` 分支
3. 在 GitHub 仓库设置中启用 Pages，Source 选择 `GitHub Actions`
4. push 后 workflow 会自动构建并发布 `dist`

访问地址格式：

```text
https://<你的GitHub用户名>.github.io/qic-progress-report/
```
