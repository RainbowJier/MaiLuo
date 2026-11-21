package com.demo.controller;

import com.demo.dto.OrderDTO;
import com.demo.service.OrderService;
import com.demo.vo.OrderVO;
import org.springframework.data.domain.Page;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/order")
public class OrderController {

    private final OrderService orderService;

    public OrderController(OrderService orderService) {
        this.orderService = orderService;
    }

    @GetMapping("/list")
    public Page<OrderVO> list(@RequestParam int page, @RequestParam int size,
                              @RequestParam(required = false) String keyword) {
        return orderService.queryByUser(page, size, keyword);
    }

    @PostMapping("/create")
    public Long create(@RequestBody OrderDTO dto) {
        return orderService.saveOrder(dto);
    }

    @PutMapping("/{id}")
    public void update(@PathVariable Long id, @RequestBody OrderDTO dto) {
        orderService.updateOrder(id, dto);
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable Long id) {
        orderService.removeOrder(id);
    }
}
