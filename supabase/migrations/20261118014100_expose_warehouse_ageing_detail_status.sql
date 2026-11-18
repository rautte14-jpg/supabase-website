create or replace view public.inventory_presentation_stock_summary with (security_invoker=true) as
select (select on_hand_value from public.stock_ageing_summary) current_inventory_value,
(select coalesce(sum(abs(cost)),0)::numeric from public.inventory_transactions where physical_date>=date_trunc('year',current_date)::date and lower(coalesce(status,'')) in ('sold','deducted')) ytd_consumption_value,
(select count(*) from public.home_high_consumption_stock where on_hand>0 and on_hand<=5) high_use_low_stock,
(select count(*) from public.home_high_consumption_stock where on_hand<=0) high_use_out_of_stock,
(select details_available from public.stock_ageing_summary) details_available;
notify pgrst,'reload schema';
