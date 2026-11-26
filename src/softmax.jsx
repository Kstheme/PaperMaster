import React, { useEffect, useRef, useState } from 'react';
import * as Slider from '@radix-ui/react-slider';
import { init, use } from 'echarts/core';
import { BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { ReadingCard } from './reading-card.jsx';
import { useLocale } from './locale.jsx';

use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

function softmax(values) {
  const peak = Math.max(...values);
  const exponentials = values.map(value => Math.exp(value - peak));
  const sum = exponentials.reduce((total, value) => total + value, 0);
  return exponentials.map(value => value / sum);
}

export default function Softmax() {
  const { t, language } = useLocale();
  const [value, setValue] = useState(2);
  const host = useRef(null);
  const chart = useRef(null);
  const weight = softmax([value, 1, 0]);
  useEffect(() => {
    const instance = init(host.current);
    chart.current = instance;
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(host.current);
    return () => { observer.disconnect(); instance.dispose(); };
  }, []);
  useEffect(() => {
    const theme = getComputedStyle(host.current);
    const color = token => theme.getPropertyValue(token).trim();
    chart.current.setOption({
      animationDuration: 0,
      animationDurationUpdate: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 140,
      grid: { left: 64, right: 55, top: 3, bottom: 23 },
      tooltip: { trigger: 'axis', confine: true, backgroundColor: color('--surface'), borderColor: color('--line'),
        textStyle: { color: color('--text') }, valueFormatter: item => Number(item).toFixed(3) },
      xAxis: { type: 'value', min: 0, max: 1, interval: .25,
        splitLine: { lineStyle: { color: color('--line'), type: 'dashed' } },
        axisLabel: { color: color('--muted'), formatter: item => (item * 100) + '%' } },
      yAxis: { type: 'category', inverse: true, data: ['A', 'B', 'C'].map(letter => t('softmaxCandidate', { letter })), axisLabel: { color: color('--muted') } },
      series: [{ name: t('softmaxWeight'), type: 'bar', barMaxWidth: 14,
        data: weight.map((item, index) => ({ value: item, itemStyle: { color: color(index === 0 ? '--accent' : '--chart-3'), borderRadius: [0, 3, 3, 0] } })),
        label: { show: true, position: 'right', color: color('--text'), formatter: ({ value }) => value.toFixed(3) } }],
    });
  }, [value, language]);
  return <ReadingCard className="softmax-lab engineering-card" label={t('formulaCard')} kicker={t('teachingDemo')} title={t('softmaxTitle')}
    actions={<div className="sample">
      <div className="slider-label"><label id="softmax-score">{t('softmaxScore')}</label><output>{value.toFixed(1)}</output></div>
      <Slider.Root className="slider" min={-1} max={4} step={.1} value={[value]} onValueChange={([next]) => setValue(next)}>
        <Slider.Track className="track"><Slider.Range className="range"/></Slider.Track>
        <Slider.Thumb className="thumb" aria-labelledby="softmax-score"/>
      </Slider.Root>
      <div className="chart" ref={host} role="img" aria-label={t('softmaxWeights', { weights: weight.map(item => item.toFixed(3)).join(t('softmaxJoin')) })}/>
    </div>}/>;
}
