package com.demo.service;

import com.demo.dto.OrderDTO;
import com.demo.repository.OrderRepository;
import com.demo.vo.OrderVO;
import org.springframework.data.domain.Page;

@org.springframework.stereotype.Service
public class OrderService {

    private final OrderRepository orderRepository;
    private final StockService stockService;
    private final OrderValidator orderValidator = new OrderValidator();

    public OrderService(OrderRepository orderRepository, StockService stockService) {
        this.orderRepository = orderRepository;
        this.stockService = stockService;
    }

    public Page<OrderVO> queryByUser(int page, int size, String keyword) {
        return orderRepository.findByUser(page, size, keyword);
    }

    @org.springframework.transaction.annotation.Transactional
    public Long saveOrder(OrderDTO dto) {
        orderValidator.validate(dto);
        stockService.checkStock(dto.getSkuId(), dto.getQuantity());
        stockService.deductStock(dto.getSkuId(), dto.getQuantity());
        return orderRepository.insert(dto);
    }

    @org.springframework.transaction.annotation.Transactional
    public void updateOrder(Long id, OrderDTO dto) {
        orderRepository.updateWithVersion(id, dto);
    }

    @org.springframework.transaction.annotation.Transactional
    public void removeOrder(Long id) {
        orderRepository.markDeleted(id);
        orderRepository.markItemsDeleted(id);
        stockService.restoreStock(id);
    }
}
