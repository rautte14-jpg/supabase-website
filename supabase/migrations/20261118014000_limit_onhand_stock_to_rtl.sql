-- Warehouse consumers use Inventory Ageing; physical STOCK remains RTL-only.
do $views$
declare v text;
begin
 select pg_get_viewdef('public.stock_items_fast'::regclass,true) into v;
 if strpos(v,'FROM stock_items')=0 then raise exception 'Unexpected stock view definition'; end if;
 execute 'create or replace view public.stock_items_fast with (security_invoker=true) as '||replace(v,'FROM stock_items','FROM public.stock_ageing_items');
 select pg_get_viewdef('public.home_high_consumption_stock'::regclass,true) into v;
 execute 'create or replace view public.home_high_consumption_stock with (security_invoker=true) as '||replace(v,'WHERE r.consumption_rank <= 100','WHERE r.consumption_rank <= 100 AND s.item_code IS NOT NULL');
end $views$;
notify pgrst,'reload schema';
