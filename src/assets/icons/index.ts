/**
 * 首页插图资源。
 * 文件名来自设计交付（部分含空格），import 集中在这里，
 * 业务组件只引用语义化 key，避免到处写带空格的路径。
 */

import iconTextToImage from "./text-to-image.png";
import iconImageToImage from "./image-to-image.png";
import iconWorkflow from "./workflow-to-image.png";
import iconPromptLibrary from "./prompt library.png";
import iconTotalGenerated from "./total generated.png";
import iconProducedImages from "./produced images.png";
import iconSuccessRate from "./success rate.png";
import iconPrompts from "./prompts.png";

export const homeIcons = {
  text2img: iconTextToImage,
  img2img: iconImageToImage,
  workflow: iconWorkflow,
  promptLibrary: iconPromptLibrary,
  totalGenerated: iconTotalGenerated,
  producedImages: iconProducedImages,
  successRate: iconSuccessRate,
  prompts: iconPrompts,
};
