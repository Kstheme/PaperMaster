import React, { useLayoutEffect, useRef } from 'react';
import * as Tabs from '@radix-ui/react-tabs';

export function MotionTabsList({ className, value, children, ...props }) {
  const listRef = useRef(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    const active = list.querySelector('[data-state="active"]');
    if (!active) {
      delete list.dataset.indicator;
      return;
    }
    function position() {
      list.style.setProperty('--tab-x', active.offsetLeft + 'px');
      list.style.setProperty('--tab-y', (active.offsetTop + active.offsetHeight - 2) + 'px');
      list.style.setProperty('--tab-width', active.offsetWidth);
      list.dataset.indicator = '';
    }
    position();
    const observer = new ResizeObserver(position);
    observer.observe(list);
    list.querySelectorAll('[role="tab"]').forEach(tab => observer.observe(tab));
    return () => observer.disconnect();
  }, [value]);

  return <Tabs.List ref={listRef} className={className + ' moving-tabs'} {...props}>{children}</Tabs.List>;
}

export function positionHighlight(event) {
  if (event.pointerType !== 'mouse' || !matchMedia('(prefers-reduced-motion: no-preference)').matches) return;
  const element = event.currentTarget;
  const { left, top } = element.getBoundingClientRect();
  element.style.setProperty('--highlight-x', (event.clientX - left) + 'px');
  element.style.setProperty('--highlight-y', (event.clientY - top) + 'px');
}
