# DeepSeek-V4.1-Flash 音频转写与 SRT/VTT 能力核实

核实日期：2026-10-18。结论基于 DeepSeek 官方 API 文档、官方发布说明和 DeepSeek-AI 官方模型卡；未进行真实 API 调用或音频测试。

## 结论

截至核实日，DeepSeek 官方 API 的 `deepseek-flash` 指向 DeepSeek-V4.1-Flash-1017。官方资料描述该模型支持文本和图像输入、生成文本；没有列出音频输入能力。官方 Chat Completions / Responses 输入契约列有文本和图像内容，没有音频内容类型；Files API 当前限定上传 JPEG、PNG、GIF、WebP 图片。因此，**官方直连 API 没有可据以确认的音频转写入口**。

官方文档也没有承诺转写结果附带词级或句级时间戳，没有 forced alignment 接口或 SRT/VTT 输出契约。即使通过提示词要求模型返回 SRT/VTT 格式，它也只能按现有证据视为文本格式生成，不能据此认定模型听过音频或给出了真实、可校验的时间轴。

## 已证实

- DeepSeek 在 2026-09-10 发布 V4.1-Flash，说明其原生多模态能力是视觉理解；API 使用 `deepseek-flash`。旧名 `deepseek-v4-flash` 被保留兼容并路由到新模型。[官方发布说明](https://api-docs.deepseek.com/news/news260910/)
- 当前官方模型定价页将 API 名称 `deepseek-flash` 对应到 DeepSeek-V4.1-Flash-1017；首次调用文档也确认这一映射。旧名 `deepseek-v4-flash` 和 `deepseek-v4-flash-vision-exp` 仍被接受，但模型已退役并路由到 1017。[官方模型与定价](https://api-docs.deepseek.com/quick_start/pricing/) · [官方 API 快速开始](https://api-docs.deepseek.com/quick_start/agent_integrations/)
- 官方模型卡称模型原生处理 images and text，并以自回归方式生成文本；视觉架构介绍的是图像编码器。模型卡中没有音频或时间戳说明。[DeepSeek-AI 官方模型卡](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash)
- 官方 Chat Completions 接口将用户消息内容定义为字符串或图像输入内容块；官方 Responses 接口支持 `input_text`、`output_text` 与 `input_image` 等结构，并写明不支持 file inputs。[Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/) · [Responses API](https://api-docs.deepseek.com/api/create-response/)
- 官方 Files API 接受 JPEG、PNG、GIF、WebP 图片，接口说明同样限定为上传图像文件。[Files API](https://api-docs.deepseek.com/api/create-file/) · [Files API 指南](https://api-docs.deepseek.com/guides/files_api/)

## 未证实与边界

- 官方资料未证明模型可接收音频文件、音频 URL、音频 token 或 `input_audio` 类型；模型卡也未宣称音频输入。这是“官方接口文档没有提供此能力契约”的结论，不推断其内部模型权重或所有未来版本永远不具备音频能力。
- 官方资料未提供语音识别、逐词/逐句起止时间、强制对齐、字幕专用解码或 SRT/VTT 导出 API。故不能把输出格式遵循能力等同于字幕时间戳准确性。
- 第三方网关即使展示“DeepSeek V4.1 Flash 音频输入/字幕”选项，也可能由网关先调用独立 ASR/对齐服务再把文本交给 DeepSeek，或采用自定义扩展。没有该网关的具体实现和来源时，不能据此归因于 DeepSeek 官方模型；应查清实际模型、输入转换链、时间戳来源和计费方。
- DeepSeek 应用或网页端的语音输入功能（若可用）与公开 API 的模型输入契约是不同产品路径；本次资料没有证实官方应用语音能力会通过 `deepseek-flash` API 向开发者开放。

## 对字幕功能的直接影响

若目标是“提供音频后自动得到可用于逐句播放的 SRT/VTT”，当前证据不支持把 DeepSeek 官方 API 单独作为音频识别及定时方案。即便后续通过第三方网关或其他服务得到转写文字，仍需确认时间戳来自何处；纯文本模型生成的时间码应作为待校对猜测，不应当作音频对齐结果。
