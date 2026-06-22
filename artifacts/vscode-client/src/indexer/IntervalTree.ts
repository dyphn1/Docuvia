export class IntervalNode<T> {
  start: number;
  end: number;
  maxEnd: number;
  data: T;
  left: IntervalNode<T> | null = null;
  right: IntervalNode<T> | null = null;

  constructor(start: number, end: number, data: T) {
    this.start = start;
    this.end = end;
    this.maxEnd = end;
    this.data = data;
  }
}

export class IntervalTree<T> {
  root: IntervalNode<T> | null = null;

  insert(start: number, end: number, data: T): void {
    if (start > end) {
      const temp = start;
      start = end;
      end = temp;
    }
    this.root = this._insert(this.root, start, end, data);
  }

  private _insert(
    node: IntervalNode<T> | null,
    start: number,
    end: number,
    data: T
  ): IntervalNode<T> {
    if (node === null) {
      return new IntervalNode(start, end, data);
    }
    const cmp = start - node.start;
    if (cmp < 0) {
      node.left = this._insert(node.left, start, end, data);
    } else {
      node.right = this._insert(node.right, start, end, data);
    }

    this._updateMaxEnd(node);
    return node;
  }

  search(point: number): T | undefined {
    return this._search(this.root, point);
  }

  private _search(node: IntervalNode<T> | null, point: number): T | undefined {
    if (node === null) {
      return undefined;
    }
    if (point >= node.start && point <= node.end) {
      return node.data;
    }
    if (node.left && node.left.maxEnd >= point) {
      const leftRes = this._search(node.left, point);
      if (leftRes !== undefined) return leftRes;
    }
    return this._search(node.right, point);
  }

  shiftRanges(fromPoint: number, delta: number): void {
    if (delta === 0) return;
    this.root = this._shiftRanges(this.root, fromPoint, delta);
  }

  private _shiftRanges(
    node: IntervalNode<T> | null,
    fromPoint: number,
    delta: number
  ): IntervalNode<T> | null {
    if (node === null) return null;

    if (node.start >= fromPoint) {
      node.start += delta;
      node.end += delta;
    } else if (node.end >= fromPoint && node.start < fromPoint) {
      node.end += delta;
    }

    node.left = this._shiftRanges(node.left, fromPoint, delta);
    node.right = this._shiftRanges(node.right, fromPoint, delta);

    this._updateMaxEnd(node);
    return node;
  }

  private _updateMaxEnd(node: IntervalNode<T>) {
    let max = node.end;
    if (node.left && node.left.maxEnd > max) {
      max = node.left.maxEnd;
    }
    if (node.right && node.right.maxEnd > max) {
      max = node.right.maxEnd;
    }
    node.maxEnd = max;
  }

  clear(): void {
    this.root = null;
  }
}
