package com.demo.service;

import com.demo.dto.OrderDTO;

public class OrderValidator {

    public void validate(OrderDTO dto) {
        if (dto.getSkuId() == null || dto.getQuantity() == null || dto.getQuantity() < 1) {
            throw new IllegalArgumentException("订单参数非法");
        }
        if (dto.getAddress() == null || dto.getAddress().isBlank()) {
            throw new IllegalArgumentException("收货地址不能为空");
        }
    }
}
