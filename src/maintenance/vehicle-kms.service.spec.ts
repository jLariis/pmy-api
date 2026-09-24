import { VehicleKmsService } from './vehicle-kms.service';

describe('VehicleKmsService', () => {
  const make = (kms: number | null, opts: { throws?: boolean } = {}) => {
    const repo: any = {
      findOne: jest.fn(async () => {
        if (opts.throws) throw new Error('db caída');
        return { id: 'v1', kms };
      }),
      update: jest.fn(async () => undefined),
      manager: { query: jest.fn(async () => [{ vehicleId: 'v1' }]) },
    };
    return { svc: new VehicleKmsService(repo), repo };
  };

  it('actualiza cuando la captura es mayor', async () => {
    const { svc, repo } = make(90000);
    await svc.bump('v1', '90250', 'dispatch');
    expect(repo.update).toHaveBeenCalledWith('v1', { kms: 90250 });
  });

  it('no actualiza cuando la captura es menor', async () => {
    const { svc, repo } = make(90000);
    await svc.bump('v1', '1', 'dispatch');
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('no propaga errores', async () => {
    const { svc } = make(0, { throws: true });
    await expect(svc.bump('v1', '100', 'closure')).resolves.toBeUndefined();
  });

  it('resuelve el vehículo desde la salida', async () => {
    const { svc, repo } = make(90000);
    await svc.bumpFromDispatch('d1', '90100', 'closure');
    expect(repo.manager.query).toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith('v1', { kms: 90100 });
  });
});
