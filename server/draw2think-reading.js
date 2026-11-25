import { codeLocation, paperIdentity, paperLocation } from './evidence.js';

const title = '从一次量角读懂实现';
const sample = '教学样本 ∠ABC，以 B 为顶点，从同一个画布观察常规角、反角和空读数。';
const reuse = '工具回包同时保存执行状态和读数，调用方再单独校验画布。可用常规角、反角和空读数作为迁移后的回归用例。';

// Reviewed against this exact paper revision and repository snapshot.
export function draw2thinkWalkthrough(paper, version, repo, chapter = 'mechanism') {
  if (version?.arxivVersion !== '2605.20743v1' ||
      repo?.url?.toLowerCase() !== 'https://github.com/draw2think/harness-geometry' ||
      repo.commit !== '1941cd7db0c6b80773e9f207c7b4d965e99f394a') return undefined;
  const paperAt = page => paperLocation(paperIdentity({ paper, version }), page);
  const loop = (from, to) => codeLocation(repo, 'eval/test_agentic_geo_constructer.py', from, to);
  const engine = (from, to) => codeLocation(repo, 'symbolic/tools/geogebra_tools.py', from, to);
  const loader = (from, to) => codeLocation(repo, 'eval/loaders/geometry3k.py', from, to);
  if (chapter === 'overview') {
    const nodes = [
      { id: 'load-case', title: '准备题目', input: 'Geometry3K 切分里的题目目录、data.json 和图', operation: '评测加载器按题目 ID 筛选，可按种子抽样。从图文件和题干构造题目对象，标准答案来自正确选项文本。', output: '题干、图路径、选项、期望值、切分名和几何关系',
        why: '目录切分、随机种子和答案解析会改变复现结果。用 ∠ABC 作为理解字段的例子，具体值由演示给出。',
        evidence: [loader(27, 42), loader(56, 75), loader(101, 116)] },
      { id: 'run-tools', title: '进入推理循环', concept: '算法 1 的 Propose–Draw–Verify 循环',
        mapping: '论文的动作是模型发出的工具调用，代码里用 fc.name 与参数字典表示。二维路径把它们交给 tracker.execute，由几何引擎维护画布。',
        input: '题目和模型发出的量角调用', operation: '主循环运行工具，把返回结果装进 FunctionResponse 交回模型。', output: '工具回包与下一轮推理上下文',
        evidence: [paperAt(5), loop(1057, 1073)] },
      { id: 'record-case', title: '记录结果并验证', input: '模型最终答案、期望值与工具过程日志', operation: 'Geometry3K 走公共 validate 入口。结果同时记录答案是否通过、工具调用成功数、失败数与过程。',
        output: '一条可复查的评测结果', evidence: [loop(441, 455)] },
    ].map((node, stage) => ({ ...node, stage }));
    return { title: '一道几何题怎样流经仓库', intro: '用 Geometry3K 加载路径说明题目对象、几何引擎和评测怎样衔接。',
      sample, reuse: '固定切分和抽样种子，并保存每题的工具调用过程。回看结果时，分别排查标准答案解析、工具异常和最终答错。', nodes };
  }
  if (chapter !== 'mechanism') return undefined;
  const nodes = [
    {
      id: 'choose-angle', title: '选择动作', concept: '算法 1 的工具调用',
      input: '当前画布的三个点 A、B、C', operation: '模型提交 query_angle，主循环把参数交给 tracker.execute。B 是中间参数，也是角的顶点。',
      output: '一次带顶点与端点的量角调用', evidence: [paperAt(5), loop(1057, 1068)],
    },
    {
      id: 'measure-angle', title: '读取角度', concept: '式（1）的画布状态与查询',
      mapping: '式（1）描述动作如何改变状态并产生观测。实现中的 GeoGebra 画布保存几何状态，Angle 命令从该状态得到读数，并维护用于展示的角对象。',
      formula: 'S_k = T(S_{k-1}, a_k),\\quad O_k = O(S_k, a_k)',
      input: '当前 GeoGebra 画布和 Angle(A, B, C)', operation: '读取弧度并转成度数。若原始角度大于 180°，用 360° 减去原值，交换 A 和 C 后重新提交绘图命令。',
      output: '返回内角度数。例如，285° 折成 75°，绘图命令改为 Angle(C, B, A)。', evidence: [paperAt(4), engine(1283, 1303)],
      snippet: '1290          value_rad = ggb.get_value(args["name"])\n1291          if value_rad is None:\n1292              return cmd_str, True, "", None\n1293          value_deg = math.degrees(value_rad)\n1296          if value_deg > 180.0:\n1297              value_deg = 360.0 - value_deg',
    },
    {
      id: 'return-angle', title: '回填观测', concept: '式（1）的观测与算法 1 的历史',
      input: '工具读数与画布', operation: '执行器封装命令、执行状态、数值和画布。主循环把结果包装为 FunctionResponse，加入下一轮上下文。',
      output: '成功结果可以携带空读数。', evidence: [paperAt(4), paperAt(5), engine(1514, 1529), loop(1066, 1073)],
    },
    {
      id: 'reuse-angle', title: '抽出经验', concept: '§3.2 的测量忠实性与构造保真度',
      input: '角度回包和题设', operation: '分别检查命令是否成功、有无读数、画布是否满足题设。测量精确只能说明当前画布的角度。',
      output: '决定采用读数、补信息，还是重新构造。', evidence: [paperAt(5), engine(1287, 1303)],
    },
  ].map((node, stage) => ({ ...node, stage }));
  return { title, demo: 'angle',
    intro: '沿同一个教学样本，看模型如何提出工具调用、画布如何给出读数，以及结果如何回到下一轮推理。',
    sample, reuse, nodes };
}

export function readingRepositoryBlock(section, paper, version, repo) {
  if (!section.repository) return undefined;
  const walkthrough = section.repository.walkthrough ?? draw2thinkWalkthrough(paper, version, repo, section.key);
  return walkthrough ? { ...section.repository, walkthrough } : section.repository;
}
