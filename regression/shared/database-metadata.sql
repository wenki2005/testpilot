-- Read-only schema inspection only. No business rows or write statements.
-- Execute in the intended test connection, not in a production connection.
START TRANSACTION READ ONLY;

SELECT VERSION() AS mysql_version;

SELECT TABLE_NAME, TABLE_TYPE, TABLE_COMMENT
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'supply'
ORDER BY TABLE_NAME;

SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, COLUMN_TYPE,
       IS_NULLABLE, COLUMN_KEY, COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'supply'
  AND TABLE_NAME IN ('biz_dept_book_apply', 'biz_dept_book_apply_goods',
                     'biz_book_info', 'biz_order', 'biz_order_goods',
                     'biz_order_logistics_trajectory')
ORDER BY TABLE_NAME, ORDINAL_POSITION;

ROLLBACK;
