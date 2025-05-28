"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const typeorm_1 = require("typeorm");
const config_1 = require("../config/config");
const seed_utils_1 = require("./seed-utils");
const entities = require("../entities");
(async () => {
    const dbConfig = (0, config_1.config)().database;
    const dataSource = new typeorm_1.DataSource({
        ...dbConfig,
        entities: Object.values(entities),
    });
    try {
        await dataSource.initialize();
        console.log('✅ Conexión establecida');
        await (0, seed_utils_1.runSeeds)(dataSource);
        await dataSource.destroy();
        console.log('✅ Seeds ejecutados con éxito');
    }
    catch (err) {
        console.error('❌ Error ejecutando seeds:', err);
        process.exit(1);
    }
})();
//# sourceMappingURL=seed.js.map