import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Minus, Plus, RotateCcw } from 'lucide-react';
import JXG from 'jsxgraph';
import type { Graph } from '../../shared/contracts';
import { findGraphLabelPosition } from '../graph-label-layout';
import type { ScreenPoint, ScreenSegment } from '../graph-label-layout';

const colors = { blue: '#3C5D72', brown: '#AD7645', gray: '#A0A8AD' } as const;
type Props = { readonly graph: Graph };

export function GraphView({ graph }: Props) {
  const id = `graph-${useId().replace(/:/gu, '')}`;
  const boardRef = useRef<JXG.Board | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [unplacedLabels, setUnplacedLabels] = useState<string[]>([]);
  const xSpan = graph.xMax - graph.xMin;
  const ySpan = graph.yMax - graph.yMin;
  const bbox: [number, number, number, number] = [graph.xMin - xSpan * 0.08, graph.yMax + ySpan * 0.12, graph.xMax + xSpan * 0.08, graph.yMin - ySpan * 0.12];

  useEffect(() => {
    if (!(xSpan > 0 && ySpan > 0)) { setError('그래프 범위를 확인해 주세요.'); return; }
    const stage = stageRef.current;
    if (!stage) return;
    try {
      const board = JXG.JSXGraph.initBoard(id, { boundingbox: bbox, renderer: 'svg', axis: true, grid: false,
        keepaspectratio: false, showCopyright: false, showNavigation: false,
        pan: { enabled: true, needShift: false }, zoom: { wheel: false },
        defaultAxes: { x: { strokeColor: '#79848B', highlight: false }, y: { strokeColor: '#79848B', highlight: false } } });
      boardRef.current = board;
      board.suspendUpdate();
      const labelNodes = new Map<SVGTextElement, string>();
      const segments: ScreenSegment[] = [];
      const label = (x: number, y: number, text: string, anchorX: 'left' | 'right' = 'left') => {
        const { rendNode } = board.create('text', [x, y, text], {
          display: 'internal', parse: false, useMathJax: false, fixed: true, highlight: false,
          fontSize: 12, strokeColor: '#202629', anchorX, anchorY: 'bottom',
        });
        if (rendNode instanceof SVGTextElement) {
          labelNodes.set(rendNode, text);
          rendNode.style.pointerEvents = 'none';
        }
      };
      for (const area of graph.shades) board.create('polygon', area.polygon.map(point => [point.x, point.y]), {
        fillColor: colors[area.color], fillOpacity: 0.14, withLines: false, highlight: false,
        vertices: { visible: false, fixed: true, withLabel: false }, borders: { visible: false },
      });
      for (const line of graph.verticals) {
        board.create('segment', [[line.x, graph.yMin], [line.x, graph.yMax]], { strokeColor: '#A0A8AD', strokeWidth: 1, dash: 2, fixed: true, highlight: false });
        segments.push([{ x: line.x, y: graph.yMin }, { x: line.x, y: graph.yMax }]);
        if (line.label) label(line.x + xSpan * 0.015, graph.yMax - ySpan * 0.05, line.label);
      }
      for (const line of graph.horizontals) {
        board.create('segment', [[graph.xMin, line.y], [graph.xMax, line.y]], { strokeColor: '#A0A8AD', strokeWidth: 1, dash: 2, fixed: true, highlight: false });
        segments.push([{ x: graph.xMin, y: line.y }, { x: graph.xMax, y: line.y }]);
        if (line.label) label(graph.xMin + xSpan * 0.02, line.y + ySpan * 0.025, line.label);
      }
      for (const curve of graph.curves) {
        const curveSegments = curve.segments.length ? curve.segments : [curve.samples];
        for (const segment of curveSegments) {
          const finite = segment.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
          if (finite.length < 2) continue;
          for (const [index, point] of finite.entries()) {
            const next = finite[index + 1];
            if (next) segments.push([point, next]);
          }
          board.create('curve', [finite.map(point => point.x), finite.map(point => point.y)], {
            strokeColor: colors[curve.color], strokeWidth: 2.5, dash: curve.dashed ? 2 : 0,
            highlight: false, fixed: true, doAdvancedPlot: false,
          });
        }
      }
      for (const point of graph.points) {
        board.create('point', [point.x, point.y], { name: '', withLabel: false, fixed: true, size: 3,
          strokeColor: colors.blue, fillColor: point.open ? '#FFFFFF' : colors.blue, strokeWidth: 2, highlight: false });
        if (point.label) label(point.x + xSpan * 0.018, point.y + ySpan * 0.035, point.label);
      }
      for (const arrow of graph.arrows) {
        board.create('arrow', [[arrow.from.x, arrow.from.y], [arrow.to.x, arrow.to.y]], { strokeColor: colors.brown, strokeWidth: 1.5, fixed: true, highlight: false });
        segments.push([arrow.from, arrow.to]);
        if (arrow.label) label((arrow.from.x + arrow.to.x) / 2, (arrow.from.y + arrow.to.y) / 2 + ySpan * 0.025, arrow.label);
      }
      label(graph.xMax, Math.max(graph.yMin, Math.min(graph.yMax, 0)) + ySpan * 0.03, graph.xLabel || graph.variable, 'right');
      const yAxis = Math.max(graph.xMin, Math.min(graph.xMax, 0));
      const rightAligned = yAxis > graph.xMin + xSpan * 0.65;
      label(yAxis + xSpan * (rightAligned ? -0.02 : 0.02), graph.yMax, graph.yLabel || 'y', rightAligned ? 'right' : 'left');
      board.unsuspendUpdate();
      const placeLabels = () => {
        const width = board.canvasWidth;
        const height = board.canvasHeight;
        if (width < 1 || height < 1) return;
        const originX = board.origin.scrCoords[1] ?? 0;
        const originY = board.origin.scrCoords[2] ?? 0;
        const project = (point: ScreenPoint) => ({ x: originX + point.x * board.unitX, y: originY - point.y * board.unitY });
        const lines: ScreenSegment[] = segments.map(([a, b]) => [project(a), project(b)]);
        lines.push([{ x: 0, y: originY }, { x: width, y: originY }], [{ x: originX, y: 0 }, { x: originX, y: height }]);
        const occupied = [...graph.points, ...graph.arrows.map(arrow => arrow.to)].map(point => {
          const { x, y } = project(point);
          return { x: x - 5, y: y - 5, width: 10, height: 10 };
        });
        for (const tick of stage.querySelectorAll<SVGTextElement>('svg text')) {
          if (labelNodes.has(tick)) continue;
          const bounds = tick.getBBox();
          if (bounds.width > 0 && bounds.height > 0) occupied.push(bounds);
        }

        const unplaced: string[] = [];
        for (const [node, value] of labelNodes) {
          const original = node.getBBox();
          const position = findGraphLabelPosition(original, { width, height }, lines, occupied);
          node.style.visibility = position ? '' : 'hidden';
          if (position) {
            node.style.translate = `${position.x - original.x}px ${position.y - original.y}px`;
            occupied.push(position);
          } else if (original.x + original.width >= 0 && original.x <= width
            && original.y + original.height >= 0 && original.y <= height) {
            unplaced.push(value);
          }
        }
        setUnplacedLabels(previous => previous.length === unplaced.length && previous.every((value, index) => value === unplaced[index]) ? previous : unplaced);
      };
      placeLabels();
      let frame = 0;
      board.on('update', () => {
        if (frame) return;
        frame = requestAnimationFrame(() => { frame = 0; placeLabels(); });
      });
      setError('');
      return () => { cancelAnimationFrame(frame); boardRef.current = null; JXG.JSXGraph.freeBoard(board); };
    } catch (failure) {
      if (!(failure instanceof Error)) throw failure;
      if (boardRef.current) { JXG.JSXGraph.freeBoard(boardRef.current); boardRef.current = null; }
      setError('그래프를 표시하지 못했습니다. 식과 구간을 확인해 주세요.');
      return;
    }
  }, [graph, id, xSpan, ySpan]);

  function pan(direction: -1 | 1): void {
    const board = boardRef.current;
    if (!board) return;
    const current = board.getBoundingBox();
    const left = current[0] ?? graph.xMin;
    const right = current[2] ?? graph.xMax;
    const amount = (right - left) * 0.15 * direction;
    board.setBoundingBox([left + amount, current[1] ?? graph.yMax, right + amount, current[3] ?? graph.yMin], false);
  }

  return <figure className="math-graph"><figcaption>{graph.title}{graph.qualitative && <span className="badge neutral">정성적 개형</span>}</figcaption>
    <div className="graph-toolbar" aria-label="그래프 보기 조절">
      <button type="button" className="icon-button" aria-label="그래프 왼쪽으로 이동" onClick={() => pan(-1)}><ArrowLeft size={16} /></button>
      <button type="button" className="icon-button" aria-label="그래프 오른쪽으로 이동" onClick={() => pan(1)}><ArrowRight size={16} /></button>
      <button type="button" className="icon-button" aria-label="그래프 확대" onClick={() => boardRef.current?.zoomIn()}><Plus size={16} /></button>
      <button type="button" className="icon-button" aria-label="그래프 축소" onClick={() => boardRef.current?.zoomOut()}><Minus size={16} /></button>
      <button type="button" className="button quiet" onClick={() => boardRef.current?.setBoundingBox(bbox, false)}><RotateCcw size={14} />처음 보기</button>
    </div>
    {error && <p className="notice error" role="alert">{error}</p>}
    <div id={id} ref={stageRef} className="graph-stage" role="img" aria-label={`${graph.title}. ${graph.explanation}`} />
    <div className="graph-legend">
      {graph.curves.map((curve, index) => <span key={`curve-${index}`}><i className={curve.color} />{curve.label}</span>)}
      {!error && unplacedLabels.map((label, index) => <span key={`label-${index}`}>{label}</span>)}
    </div>
    {graph.explanation && <p>{graph.explanation}</p>}
  </figure>;
}
