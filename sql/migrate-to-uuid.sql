-- ============================================================================
-- MIGRACIÓN AUTOMÁTICA: integer → UUID (idempotente)
-- ============================================================================
-- Se ejecuta desde Electron main process vía `psql` portable.
-- Solo toca tablas de la app que EXISTAN (no Better Auth: user, account, session, verification).
-- productos.id permanece INTEGER (requisito del usuario).
-- ============================================================================

-- 1. Tablas candidatas a convertir (solo las que existan)
DO $$
DECLARE
    t text;
    all_tbls text[] := ARRAY[
        'abonos','cajas','categorias','cierres_caja','cliente_limites_credito',
        'clientes','compra_items','compras','configuracion','creditos',
        'kardex','marcas','metodos_pago','monedas','producto_precios',
        'proveedores','retorno_items','retornos','transacciones',
        'venta_items','venta_pagos','ventas'
    ];
    tbls text[] := ARRAY[]::text[];
    fk_rec record;
    uq_rec record;
BEGIN
    -- Filtrar solo tablas que existan
    FOREACH t IN ARRAY all_tbls LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
            tbls := tbls || t;
        END IF;
    END LOOP;

    -- 2. Eliminar TODAS las FKs que apunten a tablas que vamos a convertir
    -- (incluye FKs desde productos, que no se convierte)
    CREATE TEMP TABLE temp_fks AS
    SELECT conname, conrelid::regclass::text AS hijo,
           (SELECT string_agg(a.attname, ',' ORDER BY k.ord)
            FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord)
            JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=k.attnum) AS cols,
           con.confrelid::regclass::text AS padre
    FROM pg_constraint con
    WHERE con.contype='f' AND connamespace='public'::regnamespace
      AND con.confrelid::regclass::text = ANY(tbls);

    FOR fk_rec IN SELECT * FROM temp_fks LOOP
        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', fk_rec.hijo, fk_rec.conname);
    END LOOP;

    -- 3. Eliminar UNIQUE/PK que involucren columnas a re-tipar (salvo Better Auth y productos)
    CREATE TEMP TABLE temp_uniques AS
    SELECT conname, conrelid::regclass::text AS tabla,
           (SELECT string_agg(a.attname, ',' ORDER BY k.ord)
            FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord)
            JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=k.attnum) AS cols,
           contype
    FROM pg_constraint con
    WHERE con.contype IN ('u','p') AND connamespace='public'::regnamespace
      AND conrelid::regclass::text = ANY(tbls);

    FOR uq_rec IN SELECT * FROM temp_uniques WHERE cols = 'id' OR contype = 'u' LOOP
        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', uq_rec.tabla, uq_rec.conname);
    END LOOP;

    -- 4. Convertir cada tabla
    FOREACH t IN ARRAY tbls LOOP
        -- Columna UUID nueva con default
        EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS "id__uuid" uuid DEFAULT gen_random_uuid()', t);
        EXECUTE format('UPDATE %I SET "id__uuid" = gen_random_uuid() WHERE "id__uuid" IS NULL', t);

        -- Mapa old->new
        EXECUTE format('CREATE TEMP TABLE "map_%s" AS SELECT "id"::int AS old_id, "id__uuid" AS new_id FROM %I', t, t);

        -- Re-tipar FKs hijas que apuntan a esta tabla (solo si padre NO es productos)
        FOR fk_rec IN SELECT * FROM temp_fks WHERE padre = t LOOP
            EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS "%s__uuid" uuid', fk_rec.hijo, fk_rec.cols);
            EXECUTE format('UPDATE %I c SET "%s__uuid" = m.new_id FROM "map_%s" m WHERE c."%s" = m.old_id',
                           fk_rec.hijo, fk_rec.cols, t, fk_rec.cols);
            EXECUTE format('ALTER TABLE %I DROP COLUMN "%s"', fk_rec.hijo, fk_rec.cols);
            EXECUTE format('ALTER TABLE %I RENAME COLUMN "%s__uuid" TO "%s"', fk_rec.hijo, fk_rec.cols, fk_rec.cols);
        END LOOP;

        -- Reemplazar PK
        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I_pkey', t, t);
        EXECUTE format('ALTER TABLE %I DROP COLUMN "id"', t);
        EXECUTE format('ALTER TABLE %I RENAME COLUMN "id__uuid" TO "id"', t);
        EXECUTE format('ALTER TABLE %I ALTER COLUMN "id" SET DEFAULT gen_random_uuid()', t);
        EXECUTE format('ALTER TABLE %I ALTER COLUMN "id" SET NOT NULL', t);
        EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I_pkey PRIMARY KEY ("id")', t, t);

        EXECUTE format('DROP TABLE IF EXISTS "map_%s"', t);
    END LOOP;

    -- 5. Recrear FKs (usando definiciones guardadas, saltando Better Auth y productos)
    FOR fk_rec IN SELECT * FROM temp_fks WHERE padre NOT IN ('user','account','session','verification','productos') LOOP
        EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("%s") REFERENCES %I("id") ON DELETE CASCADE',
                       fk_rec.hijo, fk_rec.conname, fk_rec.cols, fk_rec.padre);
    END LOOP;

    -- 6. Recrear UNIQUEs
    FOR uq_rec IN SELECT * FROM temp_uniques WHERE contype = 'u' LOOP
        EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I UNIQUE (%s)',
                       uq_rec.tabla, uq_rec.conname, uq_rec.cols);
    END LOOP;

    -- 7. FKs de productos (padre = productos, se quedan integer)
    FOR fk_rec IN SELECT * FROM temp_fks WHERE padre = 'productos' LOOP
        EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("%s") REFERENCES %I("id") ON DELETE CASCADE',
                       fk_rec.hijo, fk_rec.conname, fk_rec.cols, fk_rec.padre);
    END LOOP;

    -- 8. FKs hacia Better Auth (padre en user/account/session)
    FOR fk_rec IN SELECT * FROM temp_fks WHERE padre IN ('user','account','session') LOOP
        EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("%s") REFERENCES %I("id") ON DELETE CASCADE',
                       fk_rec.hijo, fk_rec.conname, fk_rec.cols, fk_rec.padre);
    END LOOP;

    -- 9. referencia_id en kardex/transacciones → text (polimórfico) - solo si existen
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='kardex') THEN
        ALTER TABLE kardex ALTER COLUMN referencia_id TYPE text USING referencia_id::text;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='transacciones') THEN
        ALTER TABLE transacciones ALTER COLUMN referencia_id TYPE text USING referencia_id::text;
    END IF;

    RAISE NOTICE '✅ Migración UUID completada';
EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION '❌ Error en migración: %', SQLERRM;
END $$;