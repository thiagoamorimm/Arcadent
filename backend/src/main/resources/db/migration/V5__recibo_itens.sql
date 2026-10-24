-- Recibo guarda a cópia do que foi recebido (descrição, valor, forma, data) na hora da emissão.
-- Assim o PDF de um recibo cancelado continua mostrando o que ele dizia.
alter table receipts add column items jsonb not null default '[]';
