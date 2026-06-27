import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Input,
  NgZone,
  OnChanges,
  SimpleChanges,
  ViewChild,
  inject,
} from '@angular/core';
import { Chart, type ChartConfiguration, type ChartType, registerables } from 'chart.js';

const hoverLinePlugin = {
  id: 'hoverLine',
  afterDatasetsDraw(chart: any) {
    if (chart.config.type === 'line' && chart.tooltip?._active?.length) {
      const activePoint = chart.tooltip._active[0];
      const ctx = chart.ctx;
      const x = activePoint.element.x;
      const topY = chart.chartArea.top;
      const bottomY = chart.chartArea.bottom;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, topY);
      ctx.lineTo(x, bottomY);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.restore();
    }
  }
};

Chart.register(...registerables, hoverLinePlugin);

@Component({
  selector: 'app-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<canvas #canvas></canvas>`,
  // The host fills its parent (typically a `h-64` or similar fixed
  // height div in the dashboard). The canvas inside is sized to
  // 100% of the host, so chart.js's responsive resize picks up the
  // host's actual dimensions rather than the canvas's intrinsic
  // size at render time. Without `position: absolute` on the canvas
  // chart.js's own positioning kicks in and the doughnut ring
  // overflows the box.
  styles: [
    ':host { display: block; position: relative; width: 100%; height: 100%; }',
    'canvas { display: block; width: 100% !important; height: 100% !important; }',
  ],
})
export class ChartComponent implements AfterViewInit, OnChanges {
  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  @Input({ required: true }) type!: ChartType;
  // Accept `unknown` rather than `ChartConfiguration['data']` so
  // component authors can build a doughnut/line/etc. config without
  // having to satisfy chart.js's broad union type at every call
  // site. Chart.js itself accepts whatever shape the `type` says it
  // does; the union type in the public API is over-specified and
  // creates more friction than safety for our dashboard callers.
  @Input({ required: true }) data!: unknown;
  @Input() options: unknown = {};

  private chart: Chart | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);

  ngAfterViewInit(): void {
    this.render();
    // The host's parent may size itself after the chart renders
    // (CSS grid / flex settling, fonts loading, etc.). Watch the
    // host element and call chart.resize() whenever its dimensions
    // change. Run outside Angular's zone because chart.js's
    // resize handler does canvas pixel work that doesn't need CD.
    this.resizeObserver = new ResizeObserver(() => {
      if (this.chart) this.chart.resize();
    });
    this.zone.runOutsideAngular(() => {
      this.resizeObserver?.observe(this.canvasRef.nativeElement.parentElement!);
    });
    this.destroyRef.onDestroy(() => {
      this.resizeObserver?.disconnect();
      this.chart?.destroy();
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.chart) return;
    if (changes['data']) {
      this.chart.data = this.data as ChartConfiguration['data'];
      this.chart.update();
    }
    if (changes['options']) {
      // chart.js's ChartOptions type is partial-by-design; cast the
      // union at the call site so the assignment compiles.
      (this.chart as { options: unknown }).options = this.options ?? {};
      this.chart.update();
    }
  }

  private render(): void {
    this.chart = new Chart(this.canvasRef.nativeElement, {
      type: this.type,
      data: this.data as ChartConfiguration['data'],
      // this.options is typed as `unknown` (see @Input rationale); cast
      // to the chart.js options shape for the spread. The shape is
      // wide but every chart type accepts the same responsive /
      // maintainAspectRatio defaults we hard-code below, so this cast
      // is safe at runtime.
      options: {
        responsive: true,
        maintainAspectRatio: false,
        ...(this.options as ChartConfiguration['options']),
      },
    });
  }
}
