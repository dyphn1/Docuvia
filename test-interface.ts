interface IService {
  create(body: any): void;
}
class Service implements IService {
  create(body: { a: string }): void {}
}
