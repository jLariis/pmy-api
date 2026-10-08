import { DispatchStatus } from 'src/common/enums/dispatch-enum';
import { parseDispatchListFilters } from './dispatch-list-filters.util';

describe('parseDispatchListFilters', () => {
  const uuid = '52a4e98f-a3ba-47dd-8827-c9d30eb05704';

  it('sin filtros → todo vacío', () => {
    expect(parseDispatchListFilters({})).toEqual({ statuses: [], driverIds: [], days: [], is315: null });
  });

  it('acepta coma o arreglo, quita duplicados e inválidos', () => {
    const f = parseDispatchListFilters({
      status: [`${DispatchStatus.COMPLETADA},nope`, DispatchStatus.COMPLETADA],
      driverId: `${uuid},1;drop table`,
      day: ['2026-10-07', '07/10/2026'],
    });
    expect(f.statuses).toEqual([DispatchStatus.COMPLETADA]);
    expect(f.driverIds).toEqual([uuid]);
    expect(f.days).toEqual(['2026-10-07']);
  });

  it('31.5: una opción filtra; las dos = sin filtro', () => {
    expect(parseDispatchListFilters({ is315: 'true' }).is315).toBe(true);
    expect(parseDispatchListFilters({ is315: 'false' }).is315).toBe(false);
    expect(parseDispatchListFilters({ is315: 'true,false' }).is315).toBeNull();
    expect(parseDispatchListFilters({ is315: 'x' }).is315).toBeNull();
  });
});
