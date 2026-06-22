import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Input,
  OnChanges,
  SimpleChanges,
  ViewChild,
  inject,
} from '@angular/core';
import { Chart, type ChartConfiguration, type ChartType, registerables } from 'chart.js';

Chart.register(...registerables);

@Component({
  selector: 'app-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<canvas #canvas></canvas>`,
  styles: [':host { display: block; position: relative; }'],
})
export class ChartComponent implements AfterViewInit, OnChanges {
  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  @Input({ required: true }) type!: ChartType;
  @Input({ required: true }) data!: ChartConfiguration['data'];
  @Input() options: ChartConfiguration['options'] = {};

  private chart: Chart | null = null;
  private readonly destroyRef = inject(DestroyRef);

  ngAfterViewInit(): void {
    this.render();
    this.destroyRef.onDestroy(() => this.chart?.destroy());
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.chart) return;
    if (changes['data']) {
      this.chart.data = this.data;
      this.chart.update();
    }
    if (changes['options']) {
      this.chart.options = this.options ?? {};
      this.chart.update();
    }
  }

  private render(): void {
    this.chart = new Chart(this.canvasRef.nativeElement, {
      type: this.type,
      data: this.data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        ...this.options,
      },
    });
  }
}
