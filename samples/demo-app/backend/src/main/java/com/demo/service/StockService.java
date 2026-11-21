package com.demo.service;

@org.springframework.stereotype.Service
public class StockService {

    public void checkStock(Long skuId, int quantity) {
        // 查询库存是否充足，不足抛出 OutOfStockException
    }

    public void deductStock(Long skuId, int quantity) {
        // UPDATE stock SET num = num - ? WHERE sku_id = ?
    }

    public void restoreStock(Long orderId) {
        // 取消订单时返还库存
    }
}
