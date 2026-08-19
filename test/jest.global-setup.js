// Fuerza la zona horaria a UTC para TODA la suite de tests, replicando el
// entorno de producción (src/main.ts fija process.env.TZ='UTC').
//
// Debe hacerse en globalSetup (proceso padre) y NO dentro de un archivo de test:
// en Windows, libuv cachea la TZ al arrancar el proceso, así que cambiar
// process.env.TZ en runtime NO tiene efecto. Los workers de jest se generan
// DESPUÉS de este setup y heredan TZ=UTC del entorno del padre.
module.exports = async () => {
  process.env.TZ = 'UTC';
};
